package com.gustavo99g.ashtar.transmissor

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.service.quicksettings.TileService
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.audio.ScreenAudioCapturer
import io.livekit.android.events.DisconnectReason
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.AudioTrackPublishOptions
import io.livekit.android.room.participant.VideoTrackPublishOptions
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.LocalScreencastVideoTrack
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.VideoCodec
import io.livekit.android.room.track.VideoEncoding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * O serviço em primeiro plano que transmite (ADR 0038). Recebe a permissão de captura que a tela
 * pediu ao Android, pede à API o token da tela para onde o dono está, entra na sala da LiveKit como
 * `{dono}:screen-{aparelho}` e publica a tela (H.264) e, se der, o áudio do jogo. Fica com a
 * notificação "Transmitindo para..." e o botão Parar enquanto estiver no ar.
 *
 * A conexão cai quando o dono sai da sala (a API derruba a do aparelho): o serviço para sozinho e
 * mostra o motivo.
 */
class StreamService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var room: Room? = null
    private var screenTrack: LocalScreencastVideoTrack? = null
    private var audioTrack: LocalAudioTrack? = null
    private var gameAudio: GameAudio? = null
    private var session: Job? = null
    private var finished = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                finish(null)
                return START_NOT_STICKY
            }

            ACTION_START -> {
                val projection = intent.let {
                    IntentCompat.getParcelableExtra(it, EXTRA_PROJECTION, Intent::class.java)
                }
                if (projection == null || session != null) return START_NOT_STICKY
                finished = false
                // O Android 14 exige o serviço em primeiro plano, com o tipo da captura, antes de
                // abrir a captura da tela.
                goForeground(getString(R.string.notification_starting))
                StreamState.set(StreamStatus.Starting)
                refreshTile()
                session = scope.launch { run(projection) }
            }
        }
        return START_NOT_STICKY
    }

    private suspend fun run(projection: Intent) {
        val store = Store(this)
        val token = store.token
        if (token == null) {
            finish(getString(R.string.error_not_paired))
            return
        }
        try {
            val grant = withContext(Dispatchers.IO) { AshtarApi(store.apiUrl, token).screenToken() }
            val quality = store.quality
            val room = LiveKit.create(applicationContext, RoomOptions(adaptiveStream = false, dynacast = false))
            this.room = room
            room.connect(grant.url, grant.token, ConnectOptions(autoSubscribe = false))

            val local = room.localParticipant
            val name = TrackName.of(System.currentTimeMillis(), quality, store.deviceName ?: Build.MODEL)
            val track = local.createScreencastTrack(
                name = name,
                mediaProjectionPermissionResultData = projection,
                options = LocalVideoTrackOptions(
                    isScreencast = true,
                    captureParams = VideoCaptureParameter(quality.width, quality.height, quality.fps),
                ),
                onStop = { scope.launch { finish(getString(R.string.stopped_by_system)) } },
            )
            screenTrack = track
            track.startCapture()
            val published = local.publishVideoTrack(
                track,
                VideoTrackPublishOptions(
                    name = name,
                    videoEncoding = VideoEncoding(quality.bitrateBps, quality.fps),
                    // Uma camada só, como o publicador do computador (ADR 0017).
                    simulcast = false,
                    videoCodec = VideoCodec.H264.codecName,
                    source = Track.Source.SCREEN_SHARE,
                ),
            )
            if (!published) {
                finish(getString(R.string.error_publish))
                return
            }
            val audio = store.gameAudio && startGameAudio(track)

            StreamState.set(StreamStatus.Live(grant.target, audio))
            refreshTile()
            notify(getString(R.string.notification_live, grant.target.label))

            room.events.collect { event ->
                if (event is RoomEvent.Disconnected) {
                    finish(disconnectReason(event.reason))
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiException) {
            finish(error.message)
        } catch (error: Exception) {
            Log.e(TAG, "a transmissão falhou", error)
            finish(getString(R.string.error_generic))
        }
    }

    /**
     * Publica o áudio do jogo, pela captura de áudio dos apps do Android. Sem a permissão do
     * microfone, ou se a captura não abrir, a tela segue sem áudio.
     */
    @SuppressLint("MissingPermission") // conferida logo no começo
    private suspend fun startGameAudio(track: LocalScreencastVideoTrack): Boolean {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return false
        }
        val local = room?.localParticipant ?: return false
        return try {
            val capturer = ScreenAudioCapturer.createFromScreenShareTrack(track) ?: return false
            val audio = local.createAudioTrack(
                name = "screen-share-audio",
                // O jogo não é voz: nada de cancelar eco, tirar ruído ou mexer no volume.
                options = LocalAudioTrackOptions(
                    noiseSuppression = false,
                    echoCancellation = false,
                    autoGainControl = false,
                    highPassFilter = false,
                    typingNoiseDetection = false,
                ),
            )
            val mixer = GameAudio(capturer)
            audio.setAudioBufferCallback(mixer)
            audio.prewarm()
            audio.start()
            val ok = local.publishAudioTrack(
                audio,
                AudioTrackPublishOptions(
                    name = "screen-share-audio",
                    audioBitrate = 128_000,
                    dtx = false,
                    red = false,
                    source = Track.Source.SCREEN_SHARE_AUDIO,
                ),
            )
            if (ok) {
                audioTrack = audio
                gameAudio = mixer
            } else {
                audio.setAudioBufferCallback(null)
                audio.stop()
                mixer.release()
            }
            ok
        } catch (error: Exception) {
            Log.w(TAG, "sem o áudio do jogo", error)
            false
        }
    }

    private fun disconnectReason(reason: DisconnectReason): String? = when (reason) {
        DisconnectReason.CLIENT_INITIATED -> null
        DisconnectReason.PARTICIPANT_REMOVED -> getString(R.string.stopped_owner_left)
        DisconnectReason.ROOM_DELETED, DisconnectReason.ROOM_CLOSED -> getString(R.string.stopped_room_closed)
        DisconnectReason.DUPLICATE_IDENTITY -> getString(R.string.stopped_duplicate)
        else -> getString(R.string.stopped_connection)
    }

    /** Para tudo, sai da sala e deixa o motivo na tela (`null`: parou porque a pessoa pediu). */
    private fun finish(reason: String?) {
        if (finished) return
        finished = true
        audioTrack?.setAudioBufferCallback(null)
        gameAudio?.release()
        gameAudio = null
        audioTrack = null
        runCatching { screenTrack?.stop() }
        screenTrack = null
        room?.let {
            runCatching { it.disconnect() }
            runCatching { it.release() }
        }
        room = null
        val running = session
        session = null
        StreamState.set(reason?.let { StreamStatus.Stopped(it) } ?: StreamStatus.Idle)
        refreshTile()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        // Por último: o `finish` pode ter vindo de dentro da própria sessão.
        running?.cancel()
    }

    override fun onDestroy() {
        if (session != null) finish(null)
        scope.cancel()
        super.onDestroy()
    }

    private fun goForeground(text: String) {
        createChannel()
        val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            } else {
                0
            }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(text), types)
    }

    private fun notify(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, StreamService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stream)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, getString(R.string.stop), stop)
            .build()
    }

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    private fun refreshTile() {
        TileService.requestListeningState(this, ComponentName(this, StreamTileService::class.java))
    }

    companion object {
        private const val TAG = "Transmissor"
        private const val CHANNEL_ID = "transmissao"
        private const val NOTIFICATION_ID = 38
        private const val ACTION_START = "com.gustavo99g.ashtar.transmissor.START"
        private const val ACTION_STOP = "com.gustavo99g.ashtar.transmissor.STOP"
        private const val EXTRA_PROJECTION = "projection"

        /** Começa a transmissão com a permissão de captura que o Android acabou de dar. */
        fun start(context: Context, projection: Intent) {
            val intent = Intent(context, StreamService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_PROJECTION, projection)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, StreamService::class.java).setAction(ACTION_STOP))
        }
    }
}

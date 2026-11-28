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
import android.hardware.display.DisplayManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.service.quicksettings.TileService
import android.util.DisplayMetrics
import android.util.Log
import android.view.Display
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import livekit.org.webrtc.RtpParameters
import livekit.org.webrtc.VideoFrame
import livekit.org.webrtc.VideoSink
import java.util.concurrent.atomic.AtomicLong

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
    private var watchdog: Job? = null
    private var publishOptions: VideoTrackPublishOptions? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var liveLabel: String? = null
    private var finished = false

    /** Conta os quadros que a captura do Android entrega, para o [StallDetector]. */
    private val capturedFrames = AtomicLong()
    private val frameCounter = VideoSink { _: VideoFrame -> capturedFrames.incrementAndGet() }

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
                holdWifi()
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
                    // A proporção da tela de verdade (o Odin não é 16:9); a LiveKit gira sozinha.
                    captureParams = displaySize().let { (w, h) ->
                        val (long, short) = quality.captureSize(w, h)
                        VideoCaptureParameter(long, short, quality.fps)
                    },
                ),
                onStop = { scope.launch { finish(getString(R.string.stopped_by_system)) } },
            )
            screenTrack = track
            track.addRenderer(frameCounter)
            track.startCapture()
            val options = VideoTrackPublishOptions(
                name = name,
                videoEncoding = VideoEncoding(quality.bitrateBps, quality.fps),
                // Uma camada só, como o publicador do computador (ADR 0017).
                simulcast = false,
                videoCodec = VideoCodec.H264.codecName,
                source = Track.Source.SCREEN_SHARE,
                // O padrão da tela (manter a resolução) derruba os quadros quase a zero quando a
                // rede aperta, e a imagem parece congelada. Num jogo vale mais seguir andando.
                degradationPreference = RtpParameters.DegradationPreference.BALANCED,
            )
            publishOptions = options
            val published = local.publishVideoTrack(track, options)
            if (!published) {
                finish(getString(R.string.error_publish))
                return
            }
            val audio = store.gameAudio && startGameAudio(track)

            StreamState.set(StreamStatus.Live(grant.target, audio))
            refreshTile()
            liveLabel = grant.target.label
            notify(getString(R.string.notification_live, grant.target.label))
            watchdog = scope.launch { watch() }

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

    /**
     * Confere a cada [WATCH_INTERVAL_MS] se a imagem continua saindo. Se a captura entrega quadros
     * e o WebRTC não manda nenhum, publica a tela de novo (sem pedir a captura outra vez). Mostra
     * na notificação quantos quadros por segundo estão saindo, para dar para ver quando trava.
     */
    private suspend fun watch() {
        val detector = StallDetector()
        var lastRepublish = 0L
        while (scope.isActive && !finished) {
            delay(WATCH_INTERVAL_MS)
            val track = screenTrack ?: return
            val sent = runCatching { framesSent(track) }.getOrNull()
            val result = detector.check(capturedFrames.get(), sent)
            val fps = (result.sentDelta * 1000 / WATCH_INTERVAL_MS).toInt()
            val label = liveLabel ?: continue
            when (result.verdict) {
                StallDetector.Verdict.SendStuck -> {
                    val now = System.currentTimeMillis()
                    if (now - lastRepublish < REPUBLISH_COOLDOWN_MS) continue
                    lastRepublish = now
                    Log.w(TAG, "a imagem parou de sair; publicando a tela de novo")
                    notify(getString(R.string.notification_recovering))
                    republish(track)
                    detector.reset()
                }
                StallDetector.Verdict.CaptureIdle -> {
                    Log.w(TAG, "a captura do Android não entrega quadros")
                    notify(getString(R.string.notification_idle, label))
                }
                StallDetector.Verdict.Ok -> {
                    if (result.sentDelta > 0) notify(getString(R.string.notification_live_fps, label, fps))
                }
            }
        }
    }

    /** Quantos quadros de vídeo o WebRTC já mandou desta tela (`null`: ainda sem números). */
    private suspend fun framesSent(track: LocalScreencastVideoTrack): Long? {
        val report = track.getRTCStats() ?: return null
        return report.statsMap.values
            .filter { it.type == "outbound-rtp" && it.members["kind"] == "video" }
            .mapNotNull { (it.members["framesSent"] as? Number)?.toLong() }
            .maxOrNull()
    }

    private suspend fun republish(track: LocalScreencastVideoTrack) {
        val local = room?.localParticipant ?: return
        val options = publishOptions ?: return
        try {
            local.unpublishTrack(track, stopOnUnpublish = false)
            if (!local.publishVideoTrack(track, options)) finish(getString(R.string.error_publish))
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.e(TAG, "não deu para publicar a tela de novo", error)
            finish(getString(R.string.error_publish))
        }
    }

    /** O Wi-Fi em modo de baixa latência enquanto transmite, sem economia de energia no meio. */
    private fun holdWifi() {
        if (wifiLock != null) return
        val wifi = applicationContext.getSystemService(WifiManager::class.java) ?: return
        wifiLock = runCatching {
            wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, TAG).apply {
                setReferenceCounted(false)
                acquire()
            }
        }.getOrNull()
    }

    /** O tamanho da tela inteira agora, em pixels (com as barras do sistema). */
    private fun displaySize(): Pair<Int, Int> {
        val display = getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
            ?: return 0 to 0
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        display.getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
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
        watchdog?.cancel()
        watchdog = null
        runCatching { wifiLock?.release() }
        wifiLock = null
        liveLabel = null
        audioTrack?.setAudioBufferCallback(null)
        gameAudio?.release()
        gameAudio = null
        audioTrack = null
        runCatching { screenTrack?.removeRenderer(frameCounter) }
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
        private const val WATCH_INTERVAL_MS = 2_000L
        private const val REPUBLISH_COOLDOWN_MS = 20_000L

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

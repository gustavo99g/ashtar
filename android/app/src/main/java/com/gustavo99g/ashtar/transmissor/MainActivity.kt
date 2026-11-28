package com.gustavo99g.ashtar.transmissor

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A única tela do Transmissor. Sem pareamento: o endereço do servidor e o código que o Ashtar
 * mostra em Configurações › Dispositivos. Pareado: para onde a tela vai
 * agora, a qualidade, o áudio do jogo e o botão Transmitir.
 */
class MainActivity : ComponentActivity() {
    private lateinit var store: Store

    private lateinit var pairGroup: View
    private lateinit var streamGroup: View
    private lateinit var serverInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var pairButton: Button
    private lateinit var pairError: TextView
    private lateinit var ownerText: TextView
    private lateinit var targetText: TextView
    private lateinit var statusText: TextView
    private lateinit var streamButton: Button
    private lateinit var qualityGroup: RadioGroup
    private lateinit var audioCheck: CheckBox

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        askCapture()
    }

    private val capture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            StreamService.start(this, data)
            // Aberta pelo bloco das Configurações rápidas, a tela sai do caminho do jogo.
            if (intent?.action == ACTION_STREAM_NOW) moveTaskToBack(true)
        } else {
            StreamState.set(StreamStatus.Idle)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = Store(this)

        pairGroup = findViewById(R.id.pair_group)
        streamGroup = findViewById(R.id.stream_group)
        serverInput = findViewById(R.id.server_input)
        codeInput = findViewById(R.id.code_input)
        pairButton = findViewById(R.id.pair_button)
        pairError = findViewById(R.id.pair_error)
        ownerText = findViewById(R.id.owner_text)
        targetText = findViewById(R.id.target_text)
        statusText = findViewById(R.id.status_text)
        streamButton = findViewById(R.id.stream_button)
        qualityGroup = findViewById(R.id.quality_group)
        audioCheck = findViewById(R.id.audio_check)

        serverInput.setText(store.apiUrl)
        pairButton.setOnClickListener { pair() }
        streamButton.setOnClickListener { if (StreamState.isActive) StreamService.stop(this) else startStream() }
        findViewById<Button>(R.id.refresh_button).setOnClickListener { refreshTarget() }
        findViewById<Button>(R.id.forget_button).setOnClickListener {
            if (StreamState.isActive) StreamService.stop(this)
            store.forget()
            render()
        }
        qualityGroup.check(if (store.quality == Quality.LIGHT) R.id.quality_light else R.id.quality_motion)
        qualityGroup.setOnCheckedChangeListener { _, id ->
            store.quality = if (id == R.id.quality_light) Quality.LIGHT else Quality.MOTION
        }
        audioCheck.isChecked = store.gameAudio
        audioCheck.setOnCheckedChangeListener { _, checked -> store.gameAudio = checked }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                StreamState.status.collect { renderStatus(it) }
            }
        }
        render()
        // Recriada (ao girar a tela, por exemplo), não pede de novo.
        if (savedInstanceState == null) handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (store.token != null) refreshTarget()
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action == ACTION_STREAM_NOW && store.token != null && !StreamState.isActive) startStream()
    }

    private fun render() {
        val paired = store.token != null
        pairGroup.visibility = if (paired) View.GONE else View.VISIBLE
        streamGroup.visibility = if (paired) View.VISIBLE else View.GONE
        ownerText.text = getString(R.string.paired_as, store.deviceName ?: "", store.ownerName ?: "")
    }

    private fun renderStatus(status: StreamStatus) {
        streamButton.text = getString(if (StreamState.isActive) R.string.stop else R.string.stream)
        streamButton.isEnabled = status != StreamStatus.Starting
        statusText.text = when (status) {
            StreamStatus.Idle -> ""
            StreamStatus.Starting -> getString(R.string.status_starting)
            is StreamStatus.Live -> getString(
                if (status.audio) R.string.status_live else R.string.status_live_no_audio,
                status.target.label,
            )
            is StreamStatus.Stopped -> status.reason
        }
    }

    private fun pair() {
        val server = AshtarApi.normalizeBaseUrl(serverInput.text.toString())
        val code = codeInput.text.toString()
        if (server.isEmpty() || code.isBlank()) {
            pairError.text = getString(R.string.error_pair_fields)
            return
        }
        pairButton.isEnabled = false
        pairError.text = ""
        lifecycleScope.launch {
            try {
                val paired = withContext(Dispatchers.IO) { AshtarApi(server).pair(code, Build.MODEL.ifBlank { "Odin 3" }) }
                store.apiUrl = server
                store.token = paired.token
                store.ownerName = paired.ownerName
                store.deviceName = paired.deviceName
                codeInput.setText("")
                render()
                refreshTarget()
            } catch (error: ApiException) {
                pairError.text = error.message
            } finally {
                pairButton.isEnabled = true
            }
        }
    }

    /** Pergunta à API para onde a tela iria agora. */
    private fun refreshTarget() {
        val token = store.token ?: return
        lifecycleScope.launch {
            targetText.text = try {
                val info = withContext(Dispatchers.IO) { AshtarApi(store.apiUrl, token).self() }
                store.ownerName = info.ownerName
                store.deviceName = info.deviceName
                render()
                info.target?.let { getString(R.string.target_now, it.label) } ?: getString(R.string.target_none)
            } catch (error: ApiException) {
                if (error.status == 401) {
                    store.forget()
                    render()
                }
                error.message
            }
        }
    }

    private fun startStream() {
        StreamState.set(StreamStatus.Starting)
        val wanted = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
            if (store.gameAudio) add(Manifest.permission.RECORD_AUDIO)
        }.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (wanted.isEmpty()) askCapture() else permissions.launch(wanted.toTypedArray())
    }

    /** A confirmação do Android para capturar a tela inteira (não dá para pular). */
    private fun askCapture() {
        val manager = getSystemService(MediaProjectionManager::class.java)
        val request = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            manager.createScreenCaptureIntent()
        }
        capture.launch(request)
    }

    companion object {
        /** Aberta pelo bloco das Configurações rápidas: já pede para transmitir. */
        const val ACTION_STREAM_NOW = "com.gustavo99g.ashtar.transmissor.STREAM_NOW"
    }
}

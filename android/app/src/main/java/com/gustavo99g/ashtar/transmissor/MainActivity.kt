package com.gustavo99g.ashtar.transmissor

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.RadioGroup
import android.widget.Switch
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A única tela do Transmissor. Sem pareamento: o servidor (Internet, ou Local, que acha a API no
 * Wi-Fi sozinho) e o código de 6 números que o Ashtar mostra em Configurações › Dispositivos.
 * Pareado: para onde a tela vai agora, o botão Transmitir, a qualidade, o áudio do jogo e o atalho
 * das Configurações rápidas.
 */
class MainActivity : ComponentActivity() {
    private lateinit var store: Store

    private lateinit var ownerText: TextView
    private lateinit var pairGroup: View
    private lateinit var streamGroup: View
    private lateinit var modeGroup: RadioGroup
    private lateinit var serverInput: EditText
    private lateinit var localGroup: View
    private lateinit var localProgress: ProgressBar
    private lateinit var localIcon: ImageView
    private lateinit var localStatus: TextView
    private lateinit var localSearch: Button
    private lateinit var localInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var pairButton: Button
    private lateinit var pairError: TextView
    private lateinit var targetIcon: ImageView
    private lateinit var targetLabel: TextView
    private lateinit var targetText: TextView
    private lateinit var streamButton: Button
    private lateinit var statusRow: View
    private lateinit var liveBadge: View
    private lateinit var statusText: TextView
    private lateinit var qualityGroup: RadioGroup
    private lateinit var audioSwitch: Switch
    private lateinit var tileText: TextView
    private lateinit var tileButton: Button
    private lateinit var serverText: TextView

    private var searching: Job? = null
    private var pairing = false

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        capture.launch(Capture.request(this))
    }

    private val capture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            StreamService.start(this, data)
        } else {
            StreamState.set(StreamStatus.Idle)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = Store(this)

        ownerText = findViewById(R.id.owner_text)
        pairGroup = findViewById(R.id.pair_group)
        streamGroup = findViewById(R.id.stream_group)
        modeGroup = findViewById(R.id.mode_group)
        serverInput = findViewById(R.id.server_input)
        localGroup = findViewById(R.id.local_group)
        localProgress = findViewById(R.id.local_progress)
        localIcon = findViewById(R.id.local_icon)
        localStatus = findViewById(R.id.local_status)
        localSearch = findViewById(R.id.local_search)
        localInput = findViewById(R.id.local_input)
        codeInput = findViewById(R.id.code_input)
        pairButton = findViewById(R.id.pair_button)
        pairError = findViewById(R.id.pair_error)
        targetIcon = findViewById(R.id.target_icon)
        targetLabel = findViewById(R.id.target_label)
        targetText = findViewById(R.id.target_text)
        streamButton = findViewById(R.id.stream_button)
        statusRow = findViewById(R.id.status_row)
        liveBadge = findViewById(R.id.live_badge)
        statusText = findViewById(R.id.status_text)
        qualityGroup = findViewById(R.id.quality_group)
        audioSwitch = findViewById(R.id.audio_switch)
        tileText = findViewById(R.id.tile_text)
        tileButton = findViewById(R.id.tile_button)
        serverText = findViewById(R.id.server_text)

        // Parear
        serverInput.setText(if (store.serverMode == ServerMode.INTERNET) store.apiUrl else BuildConfig.DEFAULT_API_URL)
        localInput.setText(store.localAddress)
        modeGroup.check(if (store.serverMode == ServerMode.LOCAL) R.id.mode_local else R.id.mode_internet)
        renderMode()
        modeGroup.setOnCheckedChangeListener { _, id ->
            store.serverMode = if (id == R.id.mode_local) ServerMode.LOCAL else ServerMode.INTERNET
            renderMode()
        }
        localSearch.setOnClickListener { searchLocal() }
        pairButton.setOnClickListener { pair() }
        // Os 6 números digitados já pareiam.
        codeInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                if (s?.length == 6 && serverUrl() != null) pair()
            }
        })

        // Pareado
        streamButton.setOnClickListener { if (StreamState.isActive) StreamService.stop(this) else startStream() }
        findViewById<ImageButton>(R.id.refresh_button).setOnClickListener { refreshTarget() }
        findViewById<Button>(R.id.forget_button).setOnClickListener {
            if (StreamState.isActive) StreamService.stop(this)
            store.forget()
            render()
        }
        qualityGroup.check(if (store.quality == Quality.MOTION) R.id.quality_motion else R.id.quality_light)
        qualityGroup.setOnCheckedChangeListener { _, id ->
            store.quality = if (id == R.id.quality_motion) Quality.MOTION else Quality.LIGHT
        }
        audioSwitch.isChecked = store.gameAudio
        audioSwitch.setOnCheckedChangeListener { _, checked -> store.gameAudio = checked }
        tileButton.setOnClickListener { offerTile() }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                StreamState.status.collect { renderStatus(it) }
            }
        }
        render()
    }

    override fun onResume() {
        super.onResume()
        if (store.token != null) {
            refreshTarget()
            renderTile()
        }
    }

    private fun render() {
        val paired = store.token != null
        pairGroup.visibility = if (paired) View.GONE else View.VISIBLE
        streamGroup.visibility = if (paired) View.VISIBLE else View.GONE
        ownerText.text = if (paired) {
            getString(R.string.paired_as, store.deviceName ?: Build.MODEL, store.ownerName ?: "")
        } else {
            getString(R.string.app_subtitle)
        }
        serverText.text = getString(R.string.server_label, store.apiUrl)
        renderTile()
    }

    // --- Parear ----------------------------------------------------------------------------------

    private fun renderMode() {
        val local = modeGroup.checkedRadioButtonId == R.id.mode_local
        serverInput.visibility = if (local) View.GONE else View.VISIBLE
        localGroup.visibility = if (local) View.VISIBLE else View.GONE
        pairError.text = ""
        // Na primeira vez no Local, já procura.
        if (local && store.token == null && localInput.text.isBlank() && searching == null) searchLocal()
    }

    private fun searchLocal() {
        searching?.cancel()
        localProgress.visibility = View.VISIBLE
        localIcon.visibility = View.INVISIBLE
        localSearch.isEnabled = false
        localStatus.setTextColor(getColor(R.color.muted))
        localStatus.text = getString(R.string.local_searching)
        val port = LocalServer.portOf(localInput.text.toString())
        searching = lifecycleScope.launch {
            val search = LocalServer.find(this@MainActivity, port)
            localProgress.visibility = View.GONE
            localIcon.visibility = View.VISIBLE
            localSearch.isEnabled = true
            searching = null
            val address = search.address
            if (address != null) {
                localInput.setText(address)
                store.localAddress = address
                localStatus.setTextColor(getColor(R.color.ok))
                localStatus.text = getString(R.string.local_found, address)
                codeInput.requestFocus()
            } else {
                localStatus.text = getString(
                    if (search.miss == LocalServer.Miss.NO_WIFI) R.string.local_no_wifi else R.string.local_not_found,
                )
            }
        }
    }

    /** O endereço da API escolhido na tela, ou `null` se ainda falta. */
    private fun serverUrl(): String? =
        if (modeGroup.checkedRadioButtonId == R.id.mode_local) {
            LocalServer.baseUrl(localInput.text.toString())
        } else {
            AshtarApi.normalizeBaseUrl(serverInput.text.toString()).ifEmpty { null }
        }

    private fun pair() {
        if (pairing) return
        val server = serverUrl()
        val code = codeInput.text.toString().filter { it.isDigit() }
        if (server == null) {
            pairError.text = getString(R.string.error_pair_server)
            return
        }
        if (code.length != 6) {
            pairError.text = getString(R.string.error_pair_code)
            return
        }
        pairing = true
        pairButton.isEnabled = false
        pairButton.text = getString(R.string.pairing)
        pairError.text = ""
        val local = modeGroup.checkedRadioButtonId == R.id.mode_local
        lifecycleScope.launch {
            try {
                val paired = withContext(Dispatchers.IO) {
                    AshtarApi(server).pair(code, Build.MODEL.ifBlank { "Odin 3" })
                }
                store.apiUrl = server
                store.serverMode = if (local) ServerMode.LOCAL else ServerMode.INTERNET
                if (local) store.localAddress = localInput.text.toString().trim()
                store.token = paired.token
                store.ownerName = paired.ownerName
                store.deviceName = paired.deviceName
                codeInput.setText("")
                hideKeyboard()
                render()
                refreshTarget()
                // Logo depois de parear, já oferece o botão nas Configurações rápidas.
                if (!store.tileAdded) offerTile()
            } catch (error: ApiException) {
                pairError.text = error.message
            } finally {
                pairing = false
                pairButton.isEnabled = true
                pairButton.text = getString(R.string.pair)
            }
        }
    }

    private fun hideKeyboard() {
        getSystemService(InputMethodManager::class.java)
            ?.hideSoftInputFromWindow(codeInput.windowToken, 0)
    }

    // --- Pareado ---------------------------------------------------------------------------------

    /** Pergunta à API para onde a tela iria agora. */
    private fun refreshTarget() {
        val token = store.token ?: return
        lifecycleScope.launch {
            try {
                val info = withContext(Dispatchers.IO) { AshtarApi(store.apiUrl, token).self() }
                store.ownerName = info.ownerName
                store.deviceName = info.deviceName
                render()
                renderTarget(info.target)
            } catch (error: ApiException) {
                if (error.status == 401) {
                    store.forget()
                    render()
                    pairError.text = error.message
                    return@launch
                }
                targetIcon.setImageResource(R.drawable.ic_away)
                targetLabel.text = error.message
                targetText.text = ""
            }
        }
    }

    private fun renderTarget(target: Target?) {
        when {
            target == null -> {
                targetIcon.setImageResource(R.drawable.ic_away)
                targetLabel.text = getString(R.string.target_none_label)
                targetText.text = getString(R.string.target_none)
            }
            target.kind == "call" -> {
                targetIcon.setImageResource(R.drawable.ic_call)
                targetLabel.text = getString(R.string.target_call)
                targetText.text = target.name
            }
            else -> {
                targetIcon.setImageResource(R.drawable.ic_room)
                targetLabel.text = getString(R.string.target_room)
                targetText.text = target.name
            }
        }
    }

    private fun renderStatus(status: StreamStatus) {
        val live = status is StreamStatus.Live
        streamButton.isEnabled = status != StreamStatus.Starting
        streamButton.text = getString(
            when (status) {
                StreamStatus.Starting -> R.string.connecting
                is StreamStatus.Live -> R.string.stop_stream
                else -> R.string.stream
            },
        )
        streamButton.setBackgroundResource(if (live) R.drawable.bg_button_stop else R.drawable.bg_button_primary)
        statusRow.visibility = if (status == StreamStatus.Idle) View.GONE else View.VISIBLE
        liveBadge.visibility = if (live) View.VISIBLE else View.GONE
        statusText.setTextColor(getColor(if (status is StreamStatus.Stopped) R.color.error else R.color.muted))
        statusText.text = when (status) {
            StreamStatus.Idle -> ""
            StreamStatus.Starting -> getString(R.string.connecting)
            is StreamStatus.Live -> getString(
                if (status.audio) R.string.live_detail else R.string.live_detail_no_audio,
                status.target.label,
            )
            is StreamStatus.Stopped -> status.reason
        }
        if (live) renderTarget((status as StreamStatus.Live).target)
    }

    private fun startStream() {
        StreamState.set(StreamStatus.Starting)
        val wanted = Capture.missingPermissions(this, store.gameAudio)
        if (wanted.isEmpty()) capture.launch(Capture.request(this)) else permissions.launch(wanted.toTypedArray())
    }

    // --- Atalho rápido ---------------------------------------------------------------------------

    private fun renderTile() {
        when {
            store.tileAdded -> {
                tileText.text = getString(R.string.tile_added)
                tileButton.visibility = View.GONE
            }
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> {
                tileText.text = getString(R.string.tile_help)
                tileButton.visibility = View.VISIBLE
            }
            else -> {
                tileText.text = getString(R.string.tile_help_manual)
                tileButton.visibility = View.GONE
            }
        }
    }

    /** O Android 13 ou mais novo pergunta se pode pôr o bloco Transmitir nas Configurações rápidas. */
    private fun offerTile() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val manager = getSystemService(StatusBarManager::class.java) ?: return
        manager.requestAddTileService(
            ComponentName(this, StreamTileService::class.java),
            getString(R.string.tile_label),
            Icon.createWithResource(this, R.drawable.ic_stream),
            mainExecutor,
        ) { result ->
            if (result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ||
                result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED
            ) {
                store.tileAdded = true
                renderTile()
            }
        }
    }
}

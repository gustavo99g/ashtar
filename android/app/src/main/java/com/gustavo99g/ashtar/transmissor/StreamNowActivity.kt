package com.gustavo99g.ashtar.transmissor

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * O "Transmitir agora" do bloco das Configurações rápidas: uma tela transparente que só pede o que
 * falta (as permissões na primeira vez e a confirmação da captura, que o Android sempre pede), começa
 * a transmissão e some, de volta para o jogo. Sem pareamento, abre o app.
 */
class StreamNowActivity : ComponentActivity() {
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        askCapture()
    }

    private val capture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            StreamService.start(this, data)
        } else {
            StreamState.set(StreamStatus.Idle)
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Recriada no meio do caminho: o resultado pendente ainda chega.
        if (savedInstanceState != null) return
        val store = Store(this)
        if (store.token == null) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }
        if (StreamState.isActive) {
            finish()
            return
        }
        StreamState.set(StreamStatus.Starting)
        val wanted = Capture.missingPermissions(this, store.gameAudio)
        if (wanted.isEmpty()) askCapture() else permissions.launch(wanted.toTypedArray())
    }

    private fun askCapture() {
        capture.launch(Capture.request(this))
    }
}

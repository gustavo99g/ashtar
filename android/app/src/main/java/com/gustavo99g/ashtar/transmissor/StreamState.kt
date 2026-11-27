package com.gustavo99g.ashtar.transmissor

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Em que pé está a transmissão. A tela, o bloco das Configurações rápidas e o serviço leem daqui. */
sealed interface StreamStatus {
    data object Idle : StreamStatus

    data object Starting : StreamStatus

    /** No ar, para `target`; `audio` diz se o áudio do jogo está indo junto. */
    data class Live(val target: Target, val audio: Boolean) : StreamStatus

    /** Parou por um motivo que a pessoa precisa ver ("Você saiu da sala", "Sala cheia"). */
    data class Stopped(val reason: String) : StreamStatus
}

object StreamState {
    private val mutable = MutableStateFlow<StreamStatus>(StreamStatus.Idle)
    val status: StateFlow<StreamStatus> = mutable.asStateFlow()

    fun set(status: StreamStatus) {
        mutable.value = status
    }

    val isActive: Boolean
        get() = status.value is StreamStatus.Live || status.value is StreamStatus.Starting
}

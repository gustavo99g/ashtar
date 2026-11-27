package com.gustavo99g.ashtar.transmissor

import io.livekit.android.audio.AudioBufferCallback
import io.livekit.android.audio.ScreenAudioCapturer
import java.nio.ByteBuffer

/**
 * Só o áudio do jogo, sem o microfone. A LiveKit captura o áudio dos apps misturando-o ao que o
 * microfone gravou ([ScreenAudioCapturer] é um mixer); aqui o buffer do microfone é zerado antes,
 * e o que sai é só o jogo. O microfone continua aberto (o Android exige para capturar o áudio dos
 * apps), mas nada do que ele grava é enviado.
 */
class GameAudio(private val capturer: ScreenAudioCapturer) : AudioBufferCallback {
    override fun onBuffer(
        buffer: ByteBuffer,
        audioFormat: Int,
        channelCount: Int,
        sampleRate: Int,
        bytesRead: Int,
        captureTimeNs: Long,
    ): Long {
        silence(buffer, bytesRead)
        return capturer.onBuffer(buffer, audioFormat, channelCount, sampleRate, bytesRead, captureTimeNs)
    }

    fun release() {
        capturer.releaseAudioResources()
    }

    companion object {
        /** Zera os primeiros `bytes` do buffer: silêncio no PCM de 16 bits e no float, que a WebRTC usa. */
        fun silence(buffer: ByteBuffer, bytes: Int) {
            val end = minOf(bytes, buffer.capacity())
            for (i in 0 until end) buffer.put(i, 0)
        }
    }
}

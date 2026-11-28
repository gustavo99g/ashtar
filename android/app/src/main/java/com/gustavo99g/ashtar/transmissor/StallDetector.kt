package com.gustavo99g.ashtar.transmissor

/**
 * Percebe quando a imagem congela no ar. A cada checagem recebe quantos quadros a captura do
 * Android já entregou e quantos o WebRTC já mandou pela rede:
 *
 * - a captura segue entregando e nada sai por [stuckChecks] checagens seguidas: o envio travou
 *   ([Verdict.SendStuck]), e o serviço publica a tela de novo;
 * - a captura não entrega nada por [idleChecks] checagens: a tela parada (um menu sem animação)
 *   ou a captura do Android parou ([Verdict.CaptureIdle]); só avisa, uma vez.
 */
class StallDetector(
    private val stuckChecks: Int = 3,
    private val idleChecks: Int = 8,
) {
    enum class Verdict { Ok, SendStuck, CaptureIdle }

    data class Result(val verdict: Verdict, val sentDelta: Long)

    private var lastCaptured = -1L
    private var lastSent = -1L
    private var stuck = 0
    private var idle = 0
    private var idleReported = false

    /** `sent` nulo: o WebRTC ainda não tem números (logo depois de publicar). */
    fun check(captured: Long, sent: Long?): Result {
        if (sent == null) return Result(Verdict.Ok, 0)
        val first = lastSent < 0 || sent < lastSent
        val capturedDelta = if (lastCaptured < 0) 0 else captured - lastCaptured
        val sentDelta = if (first) 0 else sent - lastSent
        lastCaptured = captured
        lastSent = sent
        if (first) return Result(Verdict.Ok, 0)

        stuck = if (capturedDelta > 0 && sentDelta == 0L) stuck + 1 else 0
        if (capturedDelta == 0L) {
            idle++
        } else {
            idle = 0
            idleReported = false
        }

        val verdict = when {
            stuck >= stuckChecks -> {
                stuck = 0
                Verdict.SendStuck
            }
            idle >= idleChecks && !idleReported -> {
                idleReported = true
                Verdict.CaptureIdle
            }
            else -> Verdict.Ok
        }
        return Result(verdict, sentDelta)
    }

    /** Depois de publicar de novo os contadores do WebRTC recomeçam do zero. */
    fun reset() {
        lastSent = -1
        stuck = 0
    }
}

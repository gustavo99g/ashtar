package com.gustavo99g.ashtar.transmissor

import com.gustavo99g.ashtar.transmissor.StallDetector.Verdict
import org.junit.Assert.assertEquals
import org.junit.Test

class StallDetectorTest {
    @Test
    fun `quadros saindo é normal`() {
        val detector = StallDetector()
        var captured = 0L
        var sent = 0L
        repeat(10) {
            captured += 120
            sent += 118
            assertEquals(Verdict.Ok, detector.check(captured, sent).verdict)
        }
    }

    @Test
    fun `captura entregando e nada saindo é envio travado`() {
        val detector = StallDetector(stuckChecks = 3)
        detector.check(100, 100)
        assertEquals(Verdict.Ok, detector.check(200, 100).verdict)
        assertEquals(Verdict.Ok, detector.check(300, 100).verdict)
        assertEquals(Verdict.SendStuck, detector.check(400, 100).verdict)
    }

    @Test
    fun `um quadro saindo zera a contagem`() {
        val detector = StallDetector(stuckChecks = 3)
        detector.check(100, 100)
        detector.check(200, 100)
        detector.check(300, 100)
        assertEquals(Verdict.Ok, detector.check(400, 101).verdict)
        assertEquals(Verdict.Ok, detector.check(500, 101).verdict)
    }

    @Test
    fun `tela parada avisa uma vez só`() {
        val detector = StallDetector(idleChecks = 2)
        detector.check(100, 100)
        assertEquals(Verdict.Ok, detector.check(100, 100).verdict)
        assertEquals(Verdict.CaptureIdle, detector.check(100, 100).verdict)
        assertEquals(Verdict.Ok, detector.check(100, 100).verdict)
    }

    @Test
    fun `depois de publicar de novo os números recomeçam`() {
        val detector = StallDetector(stuckChecks = 2)
        detector.check(100, 500)
        detector.reset()
        assertEquals(Verdict.Ok, detector.check(200, 0).verdict)
        assertEquals(Verdict.Ok, detector.check(300, 60).verdict)
        assertEquals(60L, detector.check(400, 120).sentDelta)
    }

    @Test
    fun `sem números do WebRTC ainda é normal`() {
        val detector = StallDetector(stuckChecks = 1)
        assertEquals(Verdict.Ok, detector.check(100, null).verdict)
    }
}

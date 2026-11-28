package com.gustavo99g.ashtar.transmissor

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackNameTest {
    @Test
    fun `o nome da trilha é o mesmo do app do computador`() {
        val name = TrackName.of(1_700_000_000_123, Quality.MOTION, "Odin 3")
        assertTrue(name.startsWith("screen-share:"))
        val json = JSONObject(name.removePrefix("screen-share:"))
        assertEquals(1_700_000_000_123, json.getLong("t"))
        assertEquals("1080p60", json.getString("q"))
        assertEquals("Odin 3", json.getString("s"))
    }

    @Test
    fun `corta o título em 80 caracteres sem partir um emoji`() {
        assertEquals(80, TrackName.clip("a".repeat(100)).length)
        val emojis = "🎮".repeat(90)
        val clipped = TrackName.clip(emojis)
        assertEquals(80, clipped.codePointCount(0, clipped.length))
    }

    @Test
    fun `a qualidade desconhecida vira a leve, o padrão`() {
        assertEquals(Quality.LIGHT, Quality.fromKey("720p60"))
        assertEquals(Quality.MOTION, Quality.fromKey("1080p60"))
        assertEquals(Quality.LIGHT, Quality.fromKey("4k"))
        assertEquals(Quality.LIGHT, Quality.fromKey(null))
    }

    @Test
    fun `a captura segue a proporção da tela, deitada ou em pé`() {
        // 16:9: o de sempre.
        assertEquals(1280 to 720, Quality.LIGHT.captureSize(1920, 1080))
        assertEquals(1280 to 720, Quality.LIGHT.captureSize(1080, 1920))
        // Mais larga que 16:9 (20:9): o lado maior acompanha.
        assertEquals(1600 to 720, Quality.LIGHT.captureSize(2400, 1080))
        assertEquals(2400 to 1080, Quality.MOTION.captureSize(1080, 2400))
        // Nunca maior que a tela.
        assertEquals(1280 to 720, Quality.MOTION.captureSize(1280, 720))
        // Sempre par.
        assertEquals(1334 to 720, Quality.LIGHT.captureSize(2001, 1080))
        // Sem saber a tela, o tamanho da qualidade.
        assertEquals(1280 to 720, Quality.LIGHT.captureSize(0, 0))
    }
}

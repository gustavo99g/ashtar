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
}

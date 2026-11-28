package com.gustavo99g.ashtar.transmissor

import org.junit.Assert.assertEquals
import org.junit.Test

class AshtarApiTest {
    @Test
    fun `o endereço ganha https e perde a barra do fim`() {
        assertEquals("https://ashtar.exemplo.com", AshtarApi.normalizeBaseUrl(" ashtar.exemplo.com/ "))
        assertEquals("http://192.168.0.10:3000", AshtarApi.normalizeBaseUrl("http://192.168.0.10:3000"))
        assertEquals("", AshtarApi.normalizeBaseUrl("  "))
    }

    @Test
    fun `a recusa da API vira o texto dela`() {
        val error = AshtarApi.refusal(409, """{"kind":"share_limit","message":"Já tem 6 transmissões nesta sala."}""")
        assertEquals(409, error.status)
        assertEquals("share_limit", error.kind)
        assertEquals("Já tem 6 transmissões nesta sala.", error.message)
    }

    @Test
    fun `sem corpo, o texto sai do status`() {
        assertEquals("Este aparelho não está mais pareado. Pareie de novo.", AshtarApi.refusal(401, "").message)
        assertEquals("http", AshtarApi.refusal(502, "<html>").kind)
    }

    @Test
    fun `o destino diz sala ou ligação`() {
        assertEquals("na sala geral", Target("geral", "voice", "geral").label)
        assertEquals("na ligação com juju", Target("dm", "call", "juju").label)
    }
}

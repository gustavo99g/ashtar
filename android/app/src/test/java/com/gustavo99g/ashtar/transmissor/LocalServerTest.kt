package com.gustavo99g.ashtar.transmissor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LocalServerTest {
    private fun ip(vararg octets: Int) = ByteArray(4) { octets[it].toByte() }

    @Test
    fun `procura a faixa toda menos o próprio aparelho, com o roteador primeiro`() {
        val hosts = LocalServer.hostsAround(ip(192, 168, 0, 42), ip(192, 168, 0, 1))
        assertEquals(253, hosts.size)
        assertEquals("192.168.0.1", hosts.first())
        assertEquals(false, "192.168.0.42" in hosts)
        assertEquals(1, hosts.count { it == "192.168.0.1" })
        assertEquals("192.168.0.254", hosts.last())
    }

    @Test
    fun `sem roteador, ou com ele fora da faixa, vai em ordem`() {
        val hosts = LocalServer.hostsAround(ip(10, 0, 200, 7), null)
        assertEquals("10.0.200.1", hosts.first())
        val other = LocalServer.hostsAround(ip(10, 0, 200, 7), ip(10, 0, 0, 1))
        assertEquals("10.0.200.1", other.first())
    }

    @Test
    fun `o endereço digitado vira a URL da API, com a porta 3000 se faltar`() {
        assertEquals("http://192.168.0.10:3000", LocalServer.baseUrl("192.168.0.10"))
        assertEquals("http://192.168.0.10:3001", LocalServer.baseUrl(" 192.168.0.10:3001/ "))
        assertEquals("http://pc.local:3000", LocalServer.baseUrl("http://pc.local:3000"))
        assertNull(LocalServer.baseUrl("  "))
    }

    @Test
    fun `a porta do que foi digitado`() {
        assertEquals(3000, LocalServer.portOf(""))
        assertEquals(3001, LocalServer.portOf("192.168.0.10:3001"))
        assertEquals(8080, LocalServer.portOf("http://pc:8080/"))
        assertEquals(3000, LocalServer.portOf("192.168.0.10:99999"))
    }

    @Test
    fun `o modo do servidor guardado`() {
        assertEquals(ServerMode.LOCAL, ServerMode.fromKey("local"))
        assertEquals(ServerMode.INTERNET, ServerMode.fromKey(null))
    }
}

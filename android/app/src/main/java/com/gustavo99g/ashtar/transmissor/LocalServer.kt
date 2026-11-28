package com.gustavo99g.ashtar.transmissor

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.URL

/**
 * O modo Local (dev): acha a API do Ashtar na rede Wi-Fi do aparelho, perguntando
 * `GET /api/stream-devices/hello` a cada endereço da mesma faixa (`192.168.0.1` a `.254`), o
 * roteador primeiro. A API precisa escutar na rede (`BIND_ADDR=0.0.0.0:3000`).
 */
object LocalServer {
    const val DEFAULT_PORT = 3000
    private const val PARALLEL = 48
    private const val CONNECT_TIMEOUT_MS = 400
    private const val READ_TIMEOUT_MS = 800
    private const val SCAN_TIMEOUT_MS = 15_000L

    /** Por que a busca não achou nada. */
    enum class Miss { NO_WIFI, NOT_FOUND }

    /** O resultado da busca: o endereço achado (`192.168.0.10:3000`) ou o motivo. */
    data class Search(val address: String?, val miss: Miss?)

    suspend fun find(context: Context, port: Int): Search = withContext(Dispatchers.IO) {
        val hosts = candidates(context) ?: return@withContext Search(null, Miss.NO_WIFI)
        val found = CompletableDeferred<String?>()
        val gate = Semaphore(PARALLEL)
        val scan = launch {
            hosts.map { host ->
                launch {
                    gate.withPermit {
                        if (!found.isCompleted && probe(host, port)) found.complete("$host:$port")
                    }
                }
            }.joinAll()
            found.complete(null)
        }
        val address = withTimeoutOrNull(SCAN_TIMEOUT_MS) { found.await() }
        scan.cancel()
        Search(address, if (address == null) Miss.NOT_FOUND else null)
    }

    /** O endereço da API pelo que a pessoa digitou ou a busca achou; `null` se estiver vazio. */
    fun baseUrl(input: String): String? {
        val trimmed = input.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
        return if (hasPort(trimmed)) "http://$trimmed" else "http://$trimmed:$DEFAULT_PORT"
    }

    /** A porta do que foi digitado (`192.168.0.10:3001`), ou a padrão. */
    fun portOf(input: String): Int {
        val withoutScheme = input.trim().substringAfter("://")
        val port = withoutScheme.substringBefore('/').substringAfterLast(':', "")
        return port.toIntOrNull()?.takeIf { it in 1..65535 } ?: DEFAULT_PORT
    }

    /** Os outros endereços da faixa do aparelho (a /24), com o roteador primeiro. */
    fun hostsAround(own: ByteArray, gateway: ByteArray?): List<String> {
        fun octet(bytes: ByteArray, i: Int) = bytes[i].toInt() and 0xFF
        val prefix = "${octet(own, 0)}.${octet(own, 1)}.${octet(own, 2)}"
        val self = octet(own, 3)
        val hosts = (1..254).filter { it != self }.map { "$prefix.$it" }
        val router = gateway?.takeIf { it.size == 4 }
            ?.let { g -> (0..3).joinToString(".") { octet(g, it).toString() } }
            ?.takeIf { it in hosts }
            ?: return hosts
        return listOf(router) + hosts.filter { it != router }
    }

    private fun hasPort(host: String) = host.substringAfterLast(':', "").toIntOrNull() != null

    /** A faixa do Wi-Fi (ou do cabo) em que o aparelho está; `null` sem rede local. */
    private fun candidates(context: Context): List<String>? {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return null
        val network = manager.activeNetwork ?: return null
        val capabilities = manager.getNetworkCapabilities(network) ?: return null
        val local = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        if (!local) return null
        val link = manager.getLinkProperties(network) ?: return null
        val own = link.linkAddresses
            .map { it.address }
            .filterIsInstance<Inet4Address>()
            .firstOrNull { !it.isLoopbackAddress }
            ?: return null
        val gateway = link.routes
            .mapNotNull { it.gateway as? Inet4Address }
            .firstOrNull { !it.isAnyLocalAddress }
        return hostsAround(own.address, gateway?.address)
    }

    private fun probe(host: String, port: Int): Boolean = try {
        val connection = URL("http://$host:$port/api/stream-devices/hello").openConnection() as HttpURLConnection
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        try {
            connection.responseCode == 200 &&
                JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                    .optString("app") == "ashtar"
        } finally {
            connection.disconnect()
        }
    } catch (error: Exception) {
        false
    }
}

package com.gustavo99g.ashtar.transmissor

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Uma recusa da API (`{ kind, message }`) ou a falta de resposta, com o texto pronto para mostrar. */
class ApiException(val status: Int, val kind: String, message: String) : Exception(message)

/** Para onde a tela vai: a sala de voz ou a ligação em que o dono está. */
data class Target(val channelId: String, val kind: String, val name: String) {
    /** "na sala geral" ou "na ligação com juju". */
    val label: String
        get() = if (kind == "call") "na ligação com $name" else "na sala $name"
}

data class Paired(val token: String, val ownerName: String, val deviceName: String)

data class SelfInfo(val ownerName: String, val deviceName: String, val target: Target?)

data class ScreenToken(val token: String, val url: String, val target: Target)

/**
 * As rotas do aparelho de transmissão (ADR 0038), em `HttpURLConnection` puro. Bloqueia: chame de
 * fora da thread principal.
 */
class AshtarApi(baseUrl: String, private val token: String? = null) {
    private val base = normalizeBaseUrl(baseUrl)

    fun pair(code: String, name: String): Paired {
        val body = JSONObject().put("code", code.trim()).put("name", name)
        val json = request("POST", "/api/stream-devices/pair", body)
        return Paired(
            token = json.getString("token"),
            ownerName = shownName(json.getJSONObject("owner")),
            deviceName = json.getJSONObject("device").getString("name"),
        )
    }

    fun self(): SelfInfo {
        val json = request("GET", "/api/stream-devices/self", null)
        return SelfInfo(
            ownerName = shownName(json.getJSONObject("owner")),
            deviceName = json.getJSONObject("device").getString("name"),
            target = json.optJSONObject("target")?.let(::target),
        )
    }

    fun screenToken(): ScreenToken {
        val json = request("POST", "/api/stream-devices/self/screen-token", null)
        return ScreenToken(
            token = json.getString("token"),
            url = json.getString("url"),
            target = target(json.getJSONObject("target")),
        )
    }

    private fun request(method: String, path: String, body: JSONObject?): JSONObject {
        val connection = try {
            (URL(base + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-Stream-Device-Version", BuildConfig.VERSION_NAME)
                token?.let { setRequestProperty("Authorization", "Bearer $it") }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toString().toByteArray()) }
                }
            }
        } catch (error: IOException) {
            throw offline()
        } catch (error: IllegalArgumentException) {
            throw ApiException(0, "invalid_url", "Esse endereço do servidor não é válido.")
        }
        try {
            val status = try {
                connection.responseCode
            } catch (error: IOException) {
                throw offline()
            }
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status in 200..299) return if (text.isBlank()) JSONObject() else JSONObject(text)
            throw refusal(status, text)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        private const val TIMEOUT_MS = 10_000

        /** Sem `/` no fim, e com `https://` quando a pessoa digitou só o domínio. */
        fun normalizeBaseUrl(input: String): String {
            val trimmed = input.trim().trimEnd('/')
            if (trimmed.isEmpty()) return trimmed
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
        }

        /** O corpo de erro da API, ou um texto pelo status quando não veio um. */
        fun refusal(status: Int, text: String): ApiException {
            val parsed = runCatching { JSONObject(text) }.getOrNull()
            val kind = parsed?.optString("kind").orEmpty().ifEmpty { "http" }
            val message = parsed?.optString("message").orEmpty().ifEmpty {
                when (status) {
                    401 -> "Este aparelho não está mais pareado. Pareie de novo."
                    else -> "O servidor recusou o pedido ($status)."
                }
            }
            return ApiException(status, kind, message)
        }

        private fun offline() = ApiException(
            0,
            "network",
            "Não foi possível falar com o servidor. Confira a internet e o endereço.",
        )

        private fun shownName(user: JSONObject): String =
            user.optString("display_name").takeIf { it.isNotBlank() && it != "null" } ?: user.getString("nick")

        private fun target(json: JSONObject) = Target(
            channelId = json.getString("channel_id"),
            kind = json.getString("kind"),
            name = json.getString("name"),
        )
    }
}

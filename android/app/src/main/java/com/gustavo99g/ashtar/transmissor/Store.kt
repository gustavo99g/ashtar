package com.gustavo99g.ashtar.transmissor

import android.content.Context

/**
 * O que o Transmissor guarda no aparelho: o endereço da API, o token da sessão do aparelho (o que o
 * pareamento devolve), o nome do dono e a qualidade escolhida. Fica no armazenamento privado do app.
 */
class Store(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("transmissor", Context.MODE_PRIVATE)

    var apiUrl: String
        get() = prefs.getString(KEY_API, null) ?: BuildConfig.DEFAULT_API_URL
        set(value) = prefs.edit().putString(KEY_API, value).apply()

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var ownerName: String?
        get() = prefs.getString(KEY_OWNER, null)
        set(value) = prefs.edit().putString(KEY_OWNER, value).apply()

    var deviceName: String?
        get() = prefs.getString(KEY_DEVICE, null)
        set(value) = prefs.edit().putString(KEY_DEVICE, value).apply()

    var quality: Quality
        get() = Quality.fromKey(prefs.getString(KEY_QUALITY, null))
        set(value) = prefs.edit().putString(KEY_QUALITY, value.key).apply()

    var gameAudio: Boolean
        get() = prefs.getBoolean(KEY_AUDIO, true)
        set(value) = prefs.edit().putBoolean(KEY_AUDIO, value).apply()

    /** Desfaz o pareamento neste aparelho (o dono desvincula de verdade pelo Ashtar). */
    fun forget() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_OWNER).remove(KEY_DEVICE).apply()
    }

    private companion object {
        const val KEY_API = "api_url"
        const val KEY_TOKEN = "token"
        const val KEY_OWNER = "owner"
        const val KEY_DEVICE = "device"
        const val KEY_QUALITY = "quality"
        const val KEY_AUDIO = "game_audio"
    }
}

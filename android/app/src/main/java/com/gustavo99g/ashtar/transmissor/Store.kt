package com.gustavo99g.ashtar.transmissor

import android.content.Context

/**
 * O que o Transmissor guarda no aparelho: o endereço da API, o token da sessão do aparelho (o que o
 * pareamento devolve), o nome do dono e a qualidade escolhida. Fica no armazenamento privado do app.
 */
/** De onde vem o servidor: a internet (o Ashtar de casa) ou a rede local (desenvolvendo). */
enum class ServerMode(val key: String) {
    INTERNET("internet"),
    LOCAL("local"),
    ;

    companion object {
        fun fromKey(key: String?): ServerMode = entries.firstOrNull { it.key == key } ?: INTERNET
    }
}

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

    /** De onde vem o servidor na tela de parear: a internet (o padrão) ou a rede local (dev). */
    var serverMode: ServerMode
        get() = ServerMode.fromKey(prefs.getString(KEY_MODE, null))
        set(value) = prefs.edit().putString(KEY_MODE, value.key).apply()

    /** O último endereço local achado ou digitado (`192.168.0.10:3000`). */
    var localAddress: String
        get() = prefs.getString(KEY_LOCAL, null).orEmpty()
        set(value) = prefs.edit().putString(KEY_LOCAL, value).apply()

    /** O bloco Transmitir já está nas Configurações rápidas. */
    var tileAdded: Boolean
        get() = prefs.getBoolean(KEY_TILE, false)
        set(value) = prefs.edit().putBoolean(KEY_TILE, value).apply()

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
        const val KEY_MODE = "server_mode"
        const val KEY_LOCAL = "local_address"
        const val KEY_TILE = "tile_added"
    }
}

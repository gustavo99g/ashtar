package com.gustavo99g.ashtar.transmissor

import org.json.JSONObject

/**
 * O nome da trilha de tela, no mesmo formato do app do computador
 * (`desktop/src/features/screen-share/model/shareInfo.ts`):
 * `screen-share:{"t": <ms>, "q": "1080p60", "s": "<título>"}`. Quem assiste lê dele quando a
 * transmissão começou, a qualidade e o título da fonte.
 */
object TrackName {
    private const val PREFIX = "screen-share:"
    private const val TITLE_MAX = 80

    fun of(startedAtMs: Long, quality: Quality, title: String): String {
        val json = JSONObject()
            .put("t", startedAtMs)
            .put("q", quality.key)
            .put("s", clip(title))
        return PREFIX + json.toString()
    }

    /** Até 80 caracteres, sem partir um emoji no meio (como o `Array.from` do app). */
    fun clip(title: String): String {
        val out = StringBuilder()
        var count = 0
        var i = 0
        while (i < title.length && count < TITLE_MAX) {
            val cp = title.codePointAt(i)
            out.appendCodePoint(cp)
            i += Character.charCount(cp)
            count++
        }
        return out.toString()
    }
}

/** As qualidades do app do computador que cabem no Odin 3 (a tela dele é 1080p). */
enum class Quality(
    val key: String,
    val label: String,
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrateBps: Int,
) {
    /** Movimento: a imagem inteira da tela, para quando a internet aguenta. */
    MOTION("1080p60", "1080p · 60 fps", 1920, 1080, 60, 8_000_000),

    /** Leve: o padrão. Metade dos dados, e o portátil esquenta e gasta menos bateria. */
    LIGHT("720p60", "720p · 60 fps", 1280, 720, 60, 4_000_000),
    ;

    /**
     * O tamanho da captura (o lado maior e o menor) com a proporção da tela de verdade: a altura da
     * qualidade (720 ou 1080) no lado menor, e o maior acompanhando a tela. A LiveKit usa um tamanho
     * fixo (1280 × 720, 16:9) e gira conforme a tela; numa tela mais larga que 16:9, como a do Odin, a
     * imagem saía achatada. Nunca passa do tamanho da própria tela, e os lados são pares (o H.264 pede).
     */
    fun captureSize(displayWidth: Int, displayHeight: Int): Pair<Int, Int> {
        val long = maxOf(displayWidth, displayHeight)
        val short = minOf(displayWidth, displayHeight)
        if (long <= 0 || short <= 0) return width to height
        val captureShort = even(minOf(height, short))
        val captureLong = even(minOf(long.toLong() * captureShort / short, long.toLong()).toInt())
        return captureLong to captureShort
    }

    companion object {
        fun fromKey(key: String?): Quality = entries.firstOrNull { it.key == key } ?: LIGHT

        private fun even(n: Int) = n - n % 2
    }
}

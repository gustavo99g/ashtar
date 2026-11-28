package com.gustavo99g.ashtar.transmissor

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import androidx.core.content.ContextCompat

/** O que as duas telas que começam uma transmissão (a principal e o "Transmitir agora") pedem. */
object Capture {
    /** As permissões que faltam: as notificações e, com o áudio do jogo, o microfone. */
    fun missingPermissions(context: Context, gameAudio: Boolean): List<String> = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        if (gameAudio) add(Manifest.permission.RECORD_AUDIO)
    }.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }

    /** A confirmação do Android para capturar a tela inteira (não dá para pular). */
    fun request(context: Context): Intent {
        val manager = context.getSystemService(MediaProjectionManager::class.java)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            manager.createScreenCaptureIntent()
        }
    }
}

package com.gustavo99g.ashtar.transmissor

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * O bloco "Transmitir" das Configurações rápidas: puxa a barra, toca, confirma a captura do Android
 * e a tela já vai para onde o dono está, sem abrir o app. Transmitindo, tocar para.
 */
class StreamTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile ?: return
        val status = StreamState.status.value
        tile.state = if (StreamState.isActive) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = when (status) {
                is StreamStatus.Live -> status.target.name
                StreamStatus.Starting -> getString(R.string.tile_starting)
                else -> null
            }
        }
        tile.updateTile()
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        super.onClick()
        if (StreamState.isActive) {
            StreamService.stop(this)
            return
        }
        // A captura da tela só pode ser pedida por uma tela do app: ela abre já pedindo.
        val intent = Intent(this, MainActivity::class.java)
            .setAction(MainActivity.ACTION_STREAM_NOW)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}

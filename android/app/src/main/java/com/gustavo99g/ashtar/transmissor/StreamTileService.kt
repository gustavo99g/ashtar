package com.gustavo99g.ashtar.transmissor

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * O bloco das Configurações rápidas. Parado, é "Transmitir": puxa a barra, toca, confirma a captura
 * do Android e a tela já vai para onde o dono está, sem abrir o app. No ar, vira "Parar transmissão"
 * (aceso), e tocar para.
 */
class StreamTileService : TileService() {
    override fun onTileAdded() {
        super.onTileAdded()
        Store(this).tileAdded = true
    }

    override fun onTileRemoved() {
        super.onTileRemoved()
        Store(this).tileAdded = false
    }

    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile ?: return
        val status = StreamState.status.value
        val paired = Store(this).token != null
        tile.state = if (StreamState.isActive) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(if (StreamState.isActive) R.string.tile_label_stop else R.string.tile_label)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = when {
                status is StreamStatus.Live -> status.target.name
                status == StreamStatus.Starting -> getString(R.string.tile_starting)
                !paired -> getString(R.string.tile_unpaired)
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
        // A captura da tela só pode ser pedida por uma tela do app: a transparente, que some depois.
        val intent = Intent(this, StreamNowActivity::class.java)
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

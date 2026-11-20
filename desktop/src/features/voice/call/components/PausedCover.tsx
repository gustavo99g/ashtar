import {
	type TrackReference,
	useConnectionQualityIndicator,
} from "@livekit/components-react";
import { ConnectionQuality } from "livekit-client";
import { PauseIcon, WifiOffIcon } from "lucide-react";

/*
 * Por cima da imagem de uma transmissão parada. Quem transmite pausa silenciando a trilha de vídeo
 * (`publisher.rs`): a última imagem fica parada, e este aviso diz por quê. Quando a conexão de quem
 * transmite cai (a LiveKit dá a qualidade `lost`), a imagem também para, e o aviso diz que ela está
 * voltando (v0.6, ADR 0030).
 */
export function PausedCover({
	share,
	compact = false,
}: {
	share: TrackReference;
	compact?: boolean;
}) {
	const { quality } = useConnectionQualityIndicator({
		participant: share.participant,
	});
	const reconnecting = quality === ConnectionQuality.Lost;
	if (!reconnecting && !share.publication.isMuted) return null;
	const Icon = reconnecting ? WifiOffIcon : PauseIcon;
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rail/80 text-center">
			<Icon
				aria-hidden="true"
				className={
					compact ? "size-5 text-foreground" : "size-8 text-foreground"
				}
			/>
			<span
				className={
					compact
						? "text-xs font-semibold text-foreground"
						: "text-sm font-semibold text-foreground"
				}
			>
				{reconnecting ? "Reconectando a transmissão…" : "Transmissão pausada"}
			</span>
		</div>
	);
}

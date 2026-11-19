import { useEffect, useRef } from "react";
import { useScreenShares } from "@/features/screen-share";
import { unwatchShare, useRoomView } from "../stores/roomViewStore";

/**
 * Fecha as transmissões abertas que acabaram (ADR 0024): quem parou de transmitir sai da lista do
 * `roomView`, e o palco e a miniatura se rearrumam com as que sobraram. Só depois de a transmissão
 * ter aparecido, porque logo ao abrir (pela tela do servidor, por um aviso) a lista de trilhas ainda
 * pode vir vazia. Não desenha nada; fica montado durante a chamada (`VoiceDock`).
 */
export function WatchJanitor() {
	const shares = useScreenShares();
	const watching = useRoomView((state) => state.watching);
	const seen = useRef(new Set<string>());

	const live = new Set(
		shares.filter((share) => !share.isOwn).map((share) => share.ownerId),
	);
	const liveKey = [...live].sort().join("\n");

	useEffect(() => {
		const present = new Set(liveKey ? liveKey.split("\n") : []);
		for (const id of present) seen.current.add(id);
		for (const id of watching) {
			if (!present.has(id) && seen.current.has(id)) {
				seen.current.delete(id);
				unwatchShare(id);
			}
		}
	}, [liveKey, watching]);

	return null;
}

import { useEffect, useRef } from "react";
import { useScreenShares } from "@/features/screen-share";
import {
	unwatchShare,
	useRoomView,
	watchShare,
} from "../stores/roomViewStore";

/**
 * Até quanto tempo depois de acabar a transmissão de alguém, uma nova dessa pessoa abre sozinha
 * para quem assistia (v0.8): a partida do jogo fechou e a transmissão recomeçou no cliente, ou a
 * pessoa trocou de fonte parando e começando de novo.
 */
export const REWATCH_MS = 15_000;

/**
 * Fecha as transmissões abertas que acabaram (ADR 0024): quem parou de transmitir sai da lista do
 * `roomView`, e o palco e a miniatura se rearrumam com as que sobraram. Só depois de a transmissão
 * ter aparecido, porque logo ao abrir (pela tela do servidor, por um aviso) a lista de trilhas ainda
 * pode vir vazia. Não desenha nada; fica montado durante a chamada (`VoiceDock`).
 *
 * Quem volta a transmitir em até [`REWATCH_MS`] volta aberto para quem assistia, e em foco se
 * estava em foco: ninguém precisa clicar de novo.
 */
export function WatchJanitor() {
	const shares = useScreenShares();
	const watching = useRoomView((state) => state.watching);
	const seen = useRef(new Set<string>());
	const ended = useRef(new Map<string, { at: number; focused: boolean }>());

	const live = new Set(
		shares.filter((share) => !share.isOwn).map((share) => share.key),
	);
	const liveKey = [...live].sort().join("\n");

	useEffect(() => {
		const present = new Set(liveKey ? liveKey.split("\n") : []);
		const now = Date.now();
		for (const id of present) {
			seen.current.add(id);
			const before = ended.current.get(id);
			if (!before) continue;
			ended.current.delete(id);
			if (now - before.at > REWATCH_MS) continue;
			watchShare(id);
			if (before.focused) useRoomView.setState({ focused: id });
		}
		for (const id of watching) {
			if (!present.has(id) && seen.current.has(id)) {
				seen.current.delete(id);
				ended.current.set(id, {
					at: now,
					focused: useRoomView.getState().focused === id,
				});
				unwatchShare(id);
			}
		}
	}, [liveKey, watching]);

	return null;
}

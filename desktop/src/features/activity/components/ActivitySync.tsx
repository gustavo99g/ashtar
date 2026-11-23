import { useEffect } from "react";
import { useSession } from "@/features/identity";
import { getDetectableGames } from "@/lib/api";
import {
	activityDetectableEtag,
	activitySetDetectable,
	activityState,
	onActivityChanged,
} from "@/lib/tauri/commands";
import { setCurrentGame } from "../stores/activityStore";

/** De quanto em quanto tempo a lista é conferida de novo com o app aberto. */
export const DETECTABLE_REFRESH_MS = 6 * 60 * 60 * 1000;
/** Sem lista nenhuma ainda, a próxima tentativa. */
export const DETECTABLE_RETRY_MS = 60 * 1000;

/**
 * Liga o app ao reconhecimento do Rust (ADR 0033): o jogo de agora e cada mudança dele, e a lista
 * de jogos detectáveis, pedida à API ao abrir e a cada 6 horas (com o `ETag` da cópia do PC, então
 * quase sempre volta `304`); sem lista nenhuma ainda, a cada minuto. Uma falha não faz nada: a cópia do PC continua valendo.
 */
export function ActivitySync() {
	const connected = useSession().status === "connected";

	useEffect(() => {
		let active = true;
		const unlisten = onActivityChanged((game) => {
			if (active) setCurrentGame(game);
		});
		activityState()
			.then((game) => {
				if (active) setCurrentGame(game);
			})
			.catch(() => {});
		return () => {
			active = false;
			void unlisten.then((stop) => stop()).catch(() => {});
		};
	}, []);

	useEffect(() => {
		if (!connected) return;
		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const sync = async () => {
			let haveList = false;
			try {
				const etag = await activityDetectableEtag();
				haveList = etag !== null;
				const fresh = await getDetectableGames(etag);
				if (active && fresh) {
					await activitySetDetectable(fresh.etag, fresh.games);
					haveList = true;
				}
			} catch {
				// Fora do ar: tenta de novo mais cedo.
			}
			if (!active) return;
			// Sem lista nenhuma no PC (a API ainda está buscando a dela), de novo daqui a pouco.
			timer = setTimeout(
				() => void sync(),
				haveList ? DETECTABLE_REFRESH_MS : DETECTABLE_RETRY_MS,
			);
		};
		void sync();
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [connected]);

	return null;
}

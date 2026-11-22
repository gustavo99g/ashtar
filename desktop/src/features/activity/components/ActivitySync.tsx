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

/**
 * Liga o app ao reconhecimento do Rust (ADR 0033): o jogo de agora e cada mudança dele, e a lista
 * de jogos detectáveis, pedida à API uma vez por abertura (com o `ETag` da cópia do PC, então
 * quase sempre volta `304`). Uma falha não faz nada: a cópia do PC continua valendo.
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
		void (async () => {
			const etag = await activityDetectableEtag();
			const fresh = await getDetectableGames(etag);
			if (active && fresh) await activitySetDetectable(fresh.etag, fresh.games);
		})().catch(() => {});
		return () => {
			active = false;
		};
	}, [connected]);

	return null;
}

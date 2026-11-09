import { useEffect, useState } from "react";
import type { ShareStats } from "@/lib/tauri/commands";
import type { ScreenShareController } from "../model/controller";
import { pushStats } from "../model/health";

const EMPTY: readonly ShareStats[] = [];

/**
 * Os números do último minuto (`HISTORY_SECONDS`), o mais novo no fim: o gráfico do envio e o
 * aviso de "computador no limite". Só guarda enquanto quem usa está montado; o painel começa a
 * contar quando abre.
 */
export function useShareStatsHistory(
	controller: ScreenShareController,
): readonly ShareStats[] {
	const [history, setHistory] = useState<readonly ShareStats[]>(() => {
		const now = controller.getStats();
		return now ? [now] : EMPTY;
	});
	useEffect(
		() =>
			controller.onStats(() => {
				const next = controller.getStats();
				setHistory((current) => (next ? pushStats(current, next) : EMPTY));
			}),
		[controller],
	);
	return history;
}

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import {
	type ScreenShareController,
	type ScreenShareState,
	shareProcessWindow,
} from "@/features/screen-share";
import type { GameView } from "@/lib/tauri/commands";

/** De quanto em quanto tempo procura a janela nova, que às vezes demora a aparecer. */
export const FOLLOW_RETRY_MS = 2_000;
/** Até quando procura: depois disso, a transmissão fica onde está. */
export const FOLLOW_GIVE_UP_MS = 60_000;

/**
 * A transmissão segue o jogo de janela em janela (v0.8). Um jogo como o League of Legends tem o
 * cliente (o lobby) e a partida em processos separados: transmitindo a janela de um, quando o
 * outro, do mesmo jogo, vira o jogo do cartão, a fonte troca sozinha para a janela dele. Vale nos
 * dois sentidos: a partida acabou e o cliente voltou para a frente, a transmissão volta junto.
 *
 * Só troca se o que está no ar é a janela de um jogo que já passou pelo cartão com o mesmo nome:
 * uma fonte escolhida à mão que não é do jogo fica onde está.
 */
export function useFollowGameWindow(
	controller: ScreenShareController | null,
	share: ScreenShareState,
	game: GameView | null,
): void {
	// O nome de cada processo que já foi o jogo do cartão.
	const names = useRef(new Map<number, string>());
	if (game) names.current.set(game.pid, game.name);

	const sharedPid =
		share.status === "active" ? (share.source.processId ?? null) : null;
	const sharedName =
		sharedPid === null ? undefined : names.current.get(sharedPid);
	const follow =
		game !== null &&
		sharedPid !== null &&
		sharedPid !== game.pid &&
		sharedName === game.name;
	const targetPid = follow ? game.pid : null;
	const targetName = follow ? game.name : null;

	useEffect(() => {
		if (!controller || targetPid === null) return;
		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const started = Date.now();
		const attempt = async () => {
			const found = await shareProcessWindow(controller, targetPid).catch(
				() => false,
			);
			if (!active) return;
			if (found) {
				toast.add({
					title: `A transmissão foi para a nova janela de ${targetName}`,
				});
				return;
			}
			if (Date.now() - started < FOLLOW_GIVE_UP_MS) {
				timer = setTimeout(() => void attempt(), FOLLOW_RETRY_MS);
			}
		};
		void attempt();
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [controller, targetPid, targetName]);
}

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import {
	type ScreenShareController,
	type ScreenShareState,
	shareProcessWindow,
	windowOfProcess,
} from "@/features/screen-share";
import type { GameView } from "@/lib/tauri/commands";

/** Quanto espera o processo novo do jogo desenhar a janela antes de trocar. */
export const FOLLOW_DELAY_MS = 5_000;
/** Sem a janela ainda, de quanto em quanto tempo procura de novo. */
export const FOLLOW_RETRY_MS = 2_000;
/** Até quando procura: depois disso, a transmissão fica onde está. */
export const FOLLOW_GIVE_UP_MS = 15_000;
/** Até quando uma transmissão que acabou com a janela fechando volta para a de antes. */
export const RESUME_WITHIN_MS = 10_000;

/**
 * A transmissão segue o jogo (v0.8). Um jogo como o League of Legends tem o cliente (o lobby) e a
 * partida em processos separados, a `family` do jogo, do mais novo ao mais antigo. Transmitindo a
 * janela de um deles, a transmissão fica sempre no mais novo que tem janela, sem olhar qual está na
 * frente: a partida abriu, vai para ela uns segundos depois ([`FOLLOW_DELAY_MS`], o tempo de a
 * janela aparecer), e voltar ao cliente não muda nada. A partida fechou: a
 * transmissão, que o Rust encerra com a janela, volta a começar no cliente.
 *
 * Uma fonte escolhida à mão que não é do jogo fica onde está.
 */
export function useFollowGameWindow(
	controller: ScreenShareController | null,
	share: ScreenShareState,
	game: GameView | null,
): void {
	const family = game?.family ?? [];
	const familyKey = family.join(",");
	const sharedPid =
		share.status === "active" ? (share.source.processId ?? null) : null;
	const following = sharedPid !== null && family.includes(sharedPid);
	const name = game?.name ?? "";

	// O processo do jogo no ar por último, para voltar quando a janela dele fecha.
	const lastShared = useRef<{ pid: number; family: number[] } | null>(null);
	if (following) lastShared.current = { pid: sharedPid, family };
	else if (share.status === "active") lastShared.current = null;

	const closedPid =
		share.status === "idle" && share.ended === "sourceClosed"
			? (lastShared.current?.pid ?? null)
			: null;

	// Seguindo: o mais novo com janela.
	useEffect(() => {
		if (!controller || !following) return;
		const pids = familyKey.split(",").map(Number);
		// Já no mais novo: nada a fazer.
		if (pids[0] === sharedPid) return;
		return retrying(async () => {
			const sources = await controller.listSources();
			const best = pids.find((pid) => windowOfProcess(sources, pid));
			if (best !== undefined && best !== sharedPid) {
				const found = await shareProcessWindow(controller, best);
				if (found) moved(name);
			}
			// O mais novo ainda sem janela (a partida carregando): tenta de novo.
			return best === pids[0];
		}, FOLLOW_GIVE_UP_MS, FOLLOW_DELAY_MS);
	}, [controller, following, familyKey, sharedPid, name]);

	// A janela do jogo fechou e a transmissão acabou: volta no de antes, se tiver janela.
	useEffect(() => {
		if (!controller || closedPid === null) return;
		const pids = (lastShared.current?.family ?? []).filter(
			(pid) => pid !== closedPid,
		);
		if (pids.length === 0) return;
		return retrying(async () => {
			const sources = await controller.listSources();
			const best = pids.find((pid) => windowOfProcess(sources, pid));
			if (best === undefined) return false;
			if (await shareProcessWindow(controller, best)) moved(name);
			return true;
		}, RESUME_WITHIN_MS);
	}, [controller, closedPid, name]);
}

function moved(name: string): void {
	toast.add({ title: `A transmissão foi para a outra janela de ${name}` });
}

/**
 * Repete `attempt`, a primeira vez depois de `delayMs`, até ele dizer que acabou ou o tempo passar.
 * Devolve o cancelar.
 */
function retrying(
	attempt: () => Promise<boolean>,
	giveUpMs: number,
	delayMs = 0,
) {
	let active = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const started = Date.now();
	const run = async () => {
		const done = await attempt().catch(() => false);
		if (!active || done) return;
		if (Date.now() - started < giveUpMs) {
			timer = setTimeout(() => void run(), FOLLOW_RETRY_MS);
		}
	};
	if (delayMs > 0) timer = setTimeout(() => void run(), delayMs);
	else void run();
	return () => {
		active = false;
		clearTimeout(timer);
	};
}

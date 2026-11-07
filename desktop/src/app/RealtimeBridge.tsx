/**
 * Liga o tempo real (`lib/realtime`) à sessão e às features: conecta com a sessão conectada,
 * desconecta sem ela, e passa cada evento para o `realtime.ts` de quem se interessa. Não desenha
 * nada.
 *
 * Fica no `app/` porque é o único lugar que conhece todas as features. O `lib/realtime` não pode
 * importar nenhuma (regra de pastas da ADR 0012).
 *
 * Um 4001 ("sua sessão terminou") deixa a conexão encerrada. Para descobrir o que houve, pede o
 * `/api/me`: o 401 faz o login de novo, e o `unknown_device` leva para "saiu do grupo" pelo
 * `SessionWatcher`. Se o login der certo, a sessão continua e o tempo real liga de novo, no máximo
 * uma vez a cada 30 segundos (antes disso, espera completar os 30).
 *
 * Com o tempo real fora, as listas perguntam sozinhas (cada uma no seu `queries.ts`); o histórico
 * do chat, que não pode ser invalidado, pergunta pelo `useOfflineCatchUp` daqui.
 */
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { handleChannelsRealtime } from "@/features/channels";
import { handleChatRealtime, useOfflineCatchUp } from "@/features/chat";
import { useSession } from "@/features/identity";
import { handleMembersRealtime } from "@/features/members";
import { handleVoiceRealtime } from "@/features/voice";
import { getMe, type ServerEvent } from "@/lib/api";
import {
	type RealtimeEventInfo,
	restartRealtime,
	startRealtime,
	stopRealtime,
	subscribeRealtime,
	useRealtimeStatus,
} from "@/lib/realtime";

type Handler = (
	event: ServerEvent,
	queryClient: QueryClient,
	info: RealtimeEventInfo,
) => void;

/**
 * Religar depois de um 4001 no máximo uma vez neste tempo: um ticket que a API continua recusando
 * não vira um laço de pedidos.
 */
export const RESTART_GAP_MS = 30_000;

/** O `realtime.ts` de cada feature. */
const HANDLERS: Handler[] = [
	handleVoiceRealtime,
	handleMembersRealtime,
	handleChatRealtime,
	handleChannelsRealtime,
];

export function RealtimeBridge() {
	const queryClient = useQueryClient();
	const connected = useSession().status === "connected";
	const status = useRealtimeStatus();
	/** Quando foi o último religamento. Começa em "nunca": o primeiro não espera. */
	const lastRestart = useRef(Number.NEGATIVE_INFINITY);
	useOfflineCatchUp();

	useEffect(() => {
		if (!connected) return;
		startRealtime();
		return stopRealtime;
	}, [connected]);

	useEffect(
		() =>
			subscribeRealtime((event, info) => {
				for (const handle of HANDLERS) handle(event, queryClient, info);
			}),
		[queryClient],
	);

	useEffect(() => {
		if (status !== "ended" || !connected) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		getMe()
			.then(() => {
				if (cancelled) return;
				// Cedo demais desde o último: espera o que falta, em vez de desistir (o status
				// continuaria "ended" e nada chamaria este efeito de novo).
				const wait = Math.max(
					0,
					lastRestart.current + RESTART_GAP_MS - Date.now(),
				);
				timer = setTimeout(() => {
					lastRestart.current = Date.now();
					restartRealtime();
				}, wait);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [status, connected]);

	return null;
}

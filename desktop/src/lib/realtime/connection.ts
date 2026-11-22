/**
 * A conexão com o WebSocket da API (ADR 0015), sem React: pede o ticket, conecta, manda o `ping`
 * de 25 em 25 segundos, reconecta sozinha quando cai e avisa quem assinou de cada evento.
 *
 * - Sem nenhuma mensagem da API por 60 segundos (nem o `pong`), a conexão é dada como morta.
 * - A volta espera 1, 2, 4, 8, 16 e depois 30 segundos, com 20% de sorteio para cima ou para baixo
 *   (dez apps que caem juntos com a API não voltam todos no mesmo instante).
 * - O código 4001 é "sua sessão terminou": não reconecta. Quem usa (o `RealtimeBridge` do app)
 *   descobre o que houve chamando a API.
 * - Um ticket recusado por regra (`unauthenticated`, `client_outdated`) também para: tentar de novo
 *   não muda a resposta.
 *
 * Todo `ready` depois de uma queda é uma volta (`resumed`): o que aconteceu enquanto a conexão
 * estava fora, as features buscam de novo ao recebê-lo. O primeiro `ready` de um `start` não é
 * volta: as listas acabaram de ser buscadas ao abrir a tela.
 */
import { type ClientEvent, isRetryable, type ServerEvent } from "@/lib/api";

export type RealtimeStatus =
	/** Parada: sem sessão. */
	| "idle"
	/** A primeira conexão, ainda sem o `ready`. */
	| "connecting"
	/** Recebeu o `ready`: os eventos chegam. */
	| "open"
	/** Caiu e está esperando para voltar (ou voltando). */
	| "reconnecting"
	/** A API encerrou (4001) ou recusou o ticket por regra. */
	| "ended";

export const PING_MS = 25_000;
export const IDLE_MS = 60_000;
export const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const;
export const CLOSE_SESSION_ENDED = 4001;

export interface RealtimeDeps {
	/** Pede um ticket à API (`POST /api/realtime/ticket`). Rejeita com um `ApiError`. */
	getTicket: () => Promise<string>;
	/** O endereço `ws(s)://.../api/realtime?ticket=...`. */
	url: (ticket: string) => string;
	/** Nos testes, um WebSocket de mentira. */
	createSocket?: (url: string) => WebSocket;
	/** Nos testes, um sorteio fixo. Entre 0 e 1. */
	random?: () => number;
}

/** O que acompanha cada evento. */
export interface RealtimeEventInfo {
	/**
	 * Se já houve um `ready` antes neste `start`: num `ready`, quer dizer que a conexão caiu e
	 * voltou, e o que mudou no meio não veio por evento.
	 */
	resumed: boolean;
}

export type RealtimeListener = (
	event: ServerEvent,
	info: RealtimeEventInfo,
) => void;

export interface Realtime {
	start: () => void;
	stop: () => void;
	status: () => RealtimeStatus;
	onEvent: (listener: RealtimeListener) => () => void;
	onStatus: (listener: (status: RealtimeStatus) => void) => () => void;
	/**
	 * Manda um evento do app (o Ausente, o "digitando…"). Sem o socket aberto, não manda nada e
	 * devolve `false`: quem manda repete o que importa no próximo `open`.
	 */
	send: (event: ClientEvent) => boolean;
	/** Quando é a próxima tentativa (`Date.now()`), ou `null` fora da espera. Avisa pelo `onStatus`. */
	nextRetryAt: () => number | null;
	/** Fora do ar, esperando: tenta já, sem esperar a vez ("Tentar agora" da faixa). */
	retryNow: () => void;
}

/** Quanto esperar antes da tentativa número `attempt` (0 é a primeira volta). */
export function backoffMs(attempt: number, random: number): number {
	const seconds =
		BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
	return Math.round(seconds * 1000 * (0.8 + random * 0.4));
}

export function createRealtime(deps: RealtimeDeps): Realtime {
	const createSocket = deps.createSocket ?? ((url) => new WebSocket(url));
	const random = deps.random ?? Math.random;
	const eventListeners = new Set<RealtimeListener>();
	const statusListeners = new Set<(status: RealtimeStatus) => void>();

	let status: RealtimeStatus = "idle";
	let running = false;
	/** Muda a cada `start`/`stop`: uma promessa de ticket de uma rodada velha não conecta. */
	let generation = 0;
	let attempt = 0;
	/** Se este `start` já recebeu um `ready`. */
	let opened = false;
	let socket: WebSocket | null = null;
	let pingTimer: ReturnType<typeof setInterval> | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let retryAt: number | null = null;

	function setStatus(next: RealtimeStatus) {
		if (status === next) return;
		status = next;
		emit();
	}

	function emit() {
		for (const listener of statusListeners) listener(status);
	}

	function setRetryAt(next: number | null) {
		if (retryAt === next) return;
		retryAt = next;
		emit();
	}

	function clearTimers() {
		clearInterval(pingTimer);
		clearTimeout(idleTimer);
		clearTimeout(retryTimer);
		setRetryAt(null);
	}

	/** Solta o socket atual sem ouvir mais nada dele. */
	function dropSocket() {
		clearTimers();
		if (!socket) return;
		const old = socket;
		socket = null;
		old.onopen = old.onmessage = old.onclose = old.onerror = null;
		if (old.readyState <= 1) old.close();
	}

	function scheduleRetry() {
		dropSocket();
		setStatus("reconnecting");
		const delay = backoffMs(attempt, random());
		attempt += 1;
		retryTimer = setTimeout(() => void open(generation), delay);
		setRetryAt(Date.now() + delay);
	}

	function end() {
		dropSocket();
		setStatus("ended");
	}

	function resetIdle() {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(scheduleRetry, IDLE_MS);
	}

	async function open(round: number) {
		setRetryAt(null);
		if (status !== "reconnecting") setStatus("connecting");
		let ticket: string;
		try {
			ticket = await deps.getTicket();
		} catch (error) {
			if (round !== generation) return;
			if (isRetryable(error)) scheduleRetry();
			else end();
			return;
		}
		if (round !== generation) return;

		const ws = createSocket(deps.url(ticket));
		socket = ws;
		resetIdle();
		ws.onmessage = (message) => {
			resetIdle();
			if (typeof message.data !== "string") return;
			let event: ServerEvent;
			try {
				event = JSON.parse(message.data) as ServerEvent;
			} catch {
				return;
			}
			const info = { resumed: opened };
			if (event.type === "ready") {
				attempt = 0;
				opened = true;
				setStatus("open");
			}
			if (event.type === "pong") return;
			for (const listener of eventListeners) listener(event, info);
		};
		ws.onopen = () => {
			clearInterval(pingTimer);
			pingTimer = setInterval(() => ws.send("ping"), PING_MS);
		};
		ws.onclose = (close) => {
			if (close.code === CLOSE_SESSION_ENDED) end();
			else scheduleRetry();
		};
	}

	return {
		start() {
			if (running) return;
			running = true;
			generation += 1;
			attempt = 0;
			opened = false;
			void open(generation);
		},
		stop() {
			running = false;
			generation += 1;
			dropSocket();
			setStatus("idle");
		},
		status: () => status,
		nextRetryAt: () => retryAt,
		retryNow() {
			if (!running || retryAt === null) return;
			clearTimeout(retryTimer);
			void open(generation);
		},
		send(event) {
			if (status !== "open" || socket?.readyState !== 1) return false;
			socket.send(JSON.stringify(event));
			return true;
		},
		onEvent(listener) {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onStatus(listener) {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
	};
}

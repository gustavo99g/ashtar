/**
 * A ligação privada como máquina de estados (Etapa 20 da v0.3, ADR 0023). Funções puras: cada
 * evento do tempo real (ou resposta da API) leva o estado de antes ao de depois. Quem guarda é o
 * `callStore`; quem age (entrar na sala, tocar) é o `CallBridge`.
 *
 * As fases:
 *
 * - `idle`: nenhuma ligação.
 * - `calling`: eu liguei e está tocando do outro lado.
 * - `ringing`: está tocando para mim.
 * - `connecting`: atendida; a voz está entrando na sala da conversa.
 * - `in_call`: os dois na sala.
 * - `ended`: acabou há pouco. Fica até a pessoa fechar o aviso ou começar outra; é o que mostra o
 *   "Voltar para a sala" e o resultado.
 */
import type { Author, CallOutcome, CallView } from "@/lib/api";

export type CallPhase =
	| "idle"
	| "calling"
	| "ringing"
	| "connecting"
	| "in_call"
	| "ended";

/** Como a última ligação acabou, para o aviso do fim. */
export interface EndedCall {
	id: string;
	channelId: string;
	outcome: CallOutcome;
	/** Em segundos; só na atendida. */
	duration: number | null;
	/** A outra pessoa. */
	person: Author;
}

/** Uma chamada perdida, até a pessoa abrir a conversa. */
export interface MissedCall {
	channelId: string;
	person: Author;
	/** Quando tocou, em segundos (o `created_at` da ligação). */
	at: number;
}

export interface CallMachine {
	/** O id de quem está usando, do `ready`. */
	me: string | null;
	phase: CallPhase;
	/** A ligação tocando ou atendida. */
	call: CallView | null;
	ended: EndedCall | null;
	/**
	 * A sala de onde a pessoa saiu para entrar na ligação: é o "Voltar para a sala" do fim. `null`
	 * para quem não estava numa.
	 */
	returnRoom: string | null;
	/** As chamadas perdidas, por conversa. */
	missed: Record<string, MissedCall>;
}

export const IDLE: CallMachine = {
	me: null,
	phase: "idle",
	call: null,
	ended: null,
	returnRoom: null,
	missed: {},
};

/** A outra pessoa da ligação, do ponto de vista de `me`. */
export function otherPerson(call: CallView, me: string | null): Author {
	return call.caller.id === me ? call.callee : call.caller;
}

/** O nome que aparece: o nome visível ou, sem ele, o nick. */
export function personName(person: {
	nick: string;
	display_name: string | null;
}): string {
	return person.display_name?.trim() || person.nick;
}

/** A fase que uma ligação em andamento dá, para `me`. */
function phaseOf(call: CallView, me: string | null): CallPhase {
	if (call.outcome === "answered") return "connecting";
	return call.caller.id === me ? "calling" : "ringing";
}

/**
 * Uma ligação nova ou que mudou (`call.ringing`, `call.accepted`, ou a resposta da API). Uma
 * ligação já atendida não volta a tocar: o evento atrasado é ignorado. Se a voz já estava na sala,
 * a fase continua `in_call`.
 */
export function withCall(state: CallMachine, call: CallView): CallMachine {
	const same = state.call?.id === call.id;
	if (
		same &&
		state.call?.outcome === "answered" &&
		call.outcome === "ringing"
	) {
		return state;
	}
	const phase = phaseOf(call, state.me);
	return {
		...state,
		call,
		phase:
			same && state.phase === "in_call" && phase === "connecting"
				? "in_call"
				: phase,
		ended: same ? state.ended : null,
		returnRoom: same ? state.returnRoom : null,
	};
}

/** A voz entrou na sala da ligação. */
export function withConnected(state: CallMachine): CallMachine {
	return state.phase === "connecting" ? { ...state, phase: "in_call" } : state;
}

/**
 * O `call.ended`. Só mexe se for a ligação desta tela. A perdida entra na lista de quem não
 * atendeu.
 */
export function withEnded(
	state: CallMachine,
	ended: {
		call_id: string;
		channel_id: string;
		outcome: CallOutcome;
		duration: number | null;
	},
): CallMachine {
	const call = state.call;
	if (!call || call.id !== ended.call_id) return state;
	const person = otherPerson(call, state.me);
	const missed =
		ended.outcome === "missed" && call.caller.id !== state.me
			? {
					...state.missed,
					[call.channel_id]: {
						channelId: call.channel_id,
						person,
						at: call.created_at,
					},
				}
			: state.missed;
	return {
		...state,
		phase: "ended",
		call: null,
		missed,
		ended: {
			id: call.id,
			channelId: call.channel_id,
			outcome: ended.outcome,
			duration: ended.duration,
			person,
		},
	};
}

/**
 * O `ready`: quem é e a ligação em andamento, se há. Sem ela, uma ligação que esta tela ainda
 * achava viva acabou enquanto a conexão estava fora: some sem aviso (o registro chega pelo
 * histórico).
 */
export function withReady(
	state: CallMachine,
	me: string,
	call: CallView | null,
): CallMachine {
	const known = { ...state, me };
	if (call) return withCall(known, call);
	if (!state.call) return known;
	return { ...known, call: null, phase: "idle" };
}

/** A sala de onde a pessoa saiu para atender (ou `null`). */
export function withReturnRoom(
	state: CallMachine,
	returnRoom: string | null,
): CallMachine {
	return { ...state, returnRoom };
}

/** Fecha o aviso do fim (e o "Voltar para a sala" com ele). */
export function withoutEnded(state: CallMachine): CallMachine {
	return state.phase === "ended"
		? { ...state, phase: "idle", ended: null, returnRoom: null }
		: { ...state, ended: null, returnRoom: null };
}

/** A conversa foi aberta: a chamada perdida dela some. */
export function withoutMissed(
	state: CallMachine,
	channelId: string,
): CallMachine {
	if (!(channelId in state.missed)) return state;
	const missed = { ...state.missed };
	delete missed[channelId];
	return { ...state, missed };
}

/** "Ligação encerrada", "Chamada perdida"... do ponto de vista de quem lê. */
export function outcomeLabel(outcome: CallOutcome, mine: boolean): string {
	switch (outcome) {
		case "answered":
			return "Ligação encerrada";
		case "missed":
			return mine ? "Ninguém atendeu" : "Chamada perdida";
		case "declined":
			return "Ligação recusada";
		case "cancelled":
			return "Ligação cancelada";
		default:
			return "Ligação";
	}
}

/** A duração como o registro mostra: "45 s", "12 min", "1 h 05 min". */
export function durationLabel(seconds: number): string {
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** O tempo da ligação na tela: "0:42", "12:04", "1:02:03". */
export function clockLabel(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(s / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const rest = String(s % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
		: `${minutes}:${rest}`;
}

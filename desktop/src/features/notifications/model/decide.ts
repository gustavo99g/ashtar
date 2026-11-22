/**
 * A regra dos avisos, num lugar só (ADR 0022). Sem tela e sem estado: recebe o que aconteceu e o
 * que o app sabe agora, e devolve se aparece um cartão e qual som toca. Cada linha da regra tem o
 * seu teste em `tests/decide.test.ts`.
 *
 * - Ocupado: nada, nunca. As não lidas continuam contando (isso não é daqui).
 * - O que a pessoa já está vendo (a conversa ou o canal aberto, com o app em foco; a sala em que
 *   ela está): nada.
 * - Mensagem de canal sem menção: nada, só conta como não lida.
 * - Silenciado: só a menção passa.
 * - Cada tipo tem a sua chave em Configurações › Notificações, e o som tem outra.
 *
 * O que não é daqui: o "Não incomodar" e a tela cheia do Windows. Quem pergunta ao Windows é o
 * Rust, na hora de mostrar (`notifications.rs`).
 */
import type { Status } from "@/lib/api";
import type { NotificationPrefs } from "@/features/settings";

/** O que aconteceu. */
export type NotifyEvent =
	| { kind: "dm"; mentioned: boolean }
	| { kind: "channel"; mentioned: boolean }
	| { kind: "stream" };

export type SoundId = "dm" | "mention";

export interface DecideInput {
	event: NotifyEvent;
	status: Status;
	/** A conversa ou o canal está silenciado. */
	muted: boolean;
	/** A pessoa já está vendo: o canal ou a conversa aberto com o app em foco, ou a sala. */
	viewing: boolean;
	prefs: NotificationPrefs;
}

export interface Decision {
	/** Se aparece um cartão. */
	show: boolean;
	/** O som que acompanha o cartão, ou `null`. Sem cartão, nunca há som. */
	sound: SoundId | null;
}

const NOTHING: Decision = { show: false, sound: null };

export function decide({
	event,
	status,
	muted,
	viewing,
	prefs,
}: DecideInput): Decision {
	if (status === "busy" || viewing) return NOTHING;

	if (event.kind === "stream") {
		// Transmissão não tem som: o aviso é só para quem quiser ir ver.
		return prefs.streams ? { show: true, sound: null } : NOTHING;
	}

	const { mentioned } = event;
	if (muted && !mentioned) return NOTHING;
	if (event.kind === "channel" && !mentioned) return NOTHING;

	const allowed = event.kind === "dm" ? prefs.dms : prefs.mentions;
	if (!allowed) return NOTHING;

	if (!prefs.sounds) return { show: true, sound: null };
	return { show: true, sound: mentioned ? "mention" : "dm" };
}

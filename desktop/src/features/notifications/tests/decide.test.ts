import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATIONS, type NotificationPrefs } from "@/features/settings";
import type { Status } from "@/lib/api";
import { type Decision, decide, type NotifyEvent } from "../model/decide";

const dm: NotifyEvent = { kind: "dm", mentioned: false };
const dmMention: NotifyEvent = { kind: "dm", mentioned: true };
const channel: NotifyEvent = { kind: "channel", mentioned: false };
const mention: NotifyEvent = { kind: "channel", mentioned: true };
const stream: NotifyEvent = { kind: "stream" };

const NONE: Decision = { show: false, sound: null };

interface Row {
	name: string;
	event: NotifyEvent;
	status?: Status;
	muted?: boolean;
	viewing?: boolean;
	prefs?: Partial<NotificationPrefs>;
	expected: Decision;
}

/** A tabela da ADR 0022: cada linha da regra, e o que ela dá. */
const ROWS: Row[] = [
	{ name: "mensagem privada avisa, com o som de conversa", event: dm, expected: { show: true, sound: "dm" } },
	{ name: "menção num canal avisa, com o som de menção", event: mention, expected: { show: true, sound: "mention" } },
	{ name: "mensagem de canal sem menção nunca avisa", event: channel, expected: NONE },
	{ name: "a conversa aberta e em foco não avisa", event: dm, viewing: true, expected: NONE },
	{ name: "o canal aberto e em foco não avisa nem a menção", event: mention, viewing: true, expected: NONE },
	{ name: "Ocupado não avisa mensagem privada", event: dm, status: "busy", expected: NONE },
	{ name: "Ocupado não avisa menção", event: mention, status: "busy", expected: NONE },
	{ name: "Ocupado não avisa transmissão", event: stream, status: "busy", expected: NONE },
	{ name: "Invisível avisa como Disponível", event: dm, status: "invisible", expected: { show: true, sound: "dm" } },
	{ name: "conversa silenciada não avisa", event: dm, muted: true, expected: NONE },
	{ name: "conversa silenciada avisa a menção", event: dmMention, muted: true, expected: { show: true, sound: "mention" } },
	{ name: "canal silenciado avisa a menção", event: mention, muted: true, expected: { show: true, sound: "mention" } },
	{ name: "a chave de mensagens privadas desligada cala a conversa", event: dm, prefs: { dms: false }, expected: NONE },
	{ name: "a chave de menções desligada cala a menção", event: mention, prefs: { mentions: false }, expected: NONE },
	{ name: "a chave de menções não mexe na conversa", event: dm, prefs: { mentions: false }, expected: { show: true, sound: "dm" } },
	{ name: "sem som, o cartão aparece calado", event: dm, prefs: { sounds: false }, expected: { show: true, sound: null } },
	{ name: "transmissão avisa sem som", event: stream, expected: { show: true, sound: null } },
	{ name: "transmissão da sala em que a pessoa está não avisa", event: stream, viewing: true, expected: NONE },
	{ name: "a chave de transmissão desligada cala", event: stream, prefs: { streams: false }, expected: NONE },
];

describe("decide", () => {
	it.each(ROWS)("$name", ({ event, status, muted, viewing, prefs, expected }) => {
		expect(
			decide({
				event,
				status: status ?? "available",
				muted: muted ?? false,
				viewing: viewing ?? false,
				prefs: { ...DEFAULT_NOTIFICATIONS, ...prefs },
			}),
		).toEqual(expected);
	});
});

import { describe, expect, it } from "vitest";
import {
	clockLabel,
	durationLabel,
	IDLE,
	outcomeLabel,
	withCall,
	withConnected,
	withEnded,
	withoutEnded,
	withoutMissed,
	withReady,
	withReturnRoom,
} from "../model/machine";
import { parseAnswer, ringCard } from "../model/ring";
import { ana, callView, kid } from "./fixtures";

const asKid = withReady(IDLE, kid.id, null);
const asAna = withReady(IDLE, ana.id, null);

describe("a máquina da ligação", () => {
	it("quem liga fica chamando; quem recebe, tocando", () => {
		expect(withCall(asKid, callView()).phase).toBe("calling");
		expect(withCall(asAna, callView()).phase).toBe("ringing");
	});

	it("atendida, conecta; com a voz na sala, fica em ligação", () => {
		const answered = withCall(
			withCall(asAna, callView()),
			callView({ outcome: "answered", answered_at: 1_010 }),
		);
		expect(answered.phase).toBe("connecting");
		const live = withConnected(answered);
		expect(live.phase).toBe("in_call");
		// O mesmo evento repetido não volta para "conectando".
		expect(
			withCall(live, callView({ outcome: "answered", answered_at: 1_010 }))
				.phase,
		).toBe("in_call");
	});

	it("um toque atrasado não desfaz a atendida", () => {
		const answered = withCall(
			asAna,
			callView({ outcome: "answered", answered_at: 1_010 }),
		);
		expect(withCall(answered, callView())).toBe(answered);
	});

	it("o fim guarda o resultado; a perdida entra na lista de quem não atendeu", () => {
		const ringing = withCall(asAna, callView());
		const ended = withEnded(ringing, {
			call_id: "c1",
			channel_id: "d1",
			outcome: "missed",
			duration: null,
		});
		expect(ended.phase).toBe("ended");
		expect(ended.call).toBeNull();
		expect(ended.ended).toMatchObject({ outcome: "missed", person: kid });
		expect(ended.missed.d1).toEqual({ channelId: "d1", person: kid, at: 1_000 });

		// Para quem ligou, a perdida não é "chamada perdida".
		const mine = withEnded(withCall(asKid, callView()), {
			call_id: "c1",
			channel_id: "d1",
			outcome: "missed",
			duration: null,
		});
		expect(mine.missed).toEqual({});

		// Abrir a conversa tira a perdida.
		expect(withoutMissed(ended, "d1").missed).toEqual({});
	});

	it("o fim de outra ligação não mexe na desta tela", () => {
		const ringing = withCall(asAna, callView());
		expect(
			withEnded(ringing, {
				call_id: "outra",
				channel_id: "d1",
				outcome: "declined",
				duration: null,
			}),
		).toBe(ringing);
	});

	it("o ready traz a ligação em andamento, ou some com a que acabou fora", () => {
		const back = withReady(IDLE, "ana", callView());
		expect(back.phase).toBe("ringing");
		expect(withReady(back, "ana", null)).toMatchObject({
			phase: "idle",
			call: null,
		});
	});

	it("a sala de onde saiu vale até fechar o aviso do fim", () => {
		const live = withReturnRoom(
			withCall(asAna, callView({ outcome: "answered", answered_at: 1 })),
			"sala",
		);
		const ended = withEnded(live, {
			call_id: "c1",
			channel_id: "d1",
			outcome: "answered",
			duration: 60,
		});
		expect(ended.returnRoom).toBe("sala");
		expect(withoutEnded(ended)).toMatchObject({
			phase: "idle",
			ended: null,
			returnRoom: null,
		});
		// Uma ligação nova esquece a sala da anterior.
		expect(withCall(ended, callView({ id: "c2" })).returnRoom).toBeNull();
	});

	it("os textos do resultado e do tempo", () => {
		expect(outcomeLabel("answered", true)).toBe("Ligação encerrada");
		expect(outcomeLabel("missed", false)).toBe("Chamada perdida");
		expect(outcomeLabel("missed", true)).toBe("Ninguém atendeu");
		expect(outcomeLabel("declined", false)).toBe("Ligação recusada");
		expect(outcomeLabel("cancelled", false)).toBe("Ligação cancelada");
		expect(clockLabel(42)).toBe("0:42");
		expect(clockLabel(12 * 60 + 4)).toBe("12:04");
		expect(clockLabel(3723)).toBe("1:02:03");
		expect(durationLabel(45)).toBe("45 s");
		expect(durationLabel(12 * 60)).toBe("12 min");
		expect(durationLabel(65 * 60)).toBe("1 h 05 min");
	});
});

describe("o cartão da ligação", () => {
	it("leva quem liga e onde quem recebe está", () => {
		expect(ringCard(callView(), { inRoom: true, sharing: false })).toEqual({
			callId: "c1",
			channelId: "d1",
			person: { nick: "kid", displayName: "Kid" },
			inRoom: true,
			sharing: false,
		});
	});

	it("só aceita a resposta com a forma certa", () => {
		expect(parseAnswer({ callId: "c1", action: "accept" })).toEqual({
			callId: "c1",
			action: "accept",
		});
		expect(parseAnswer({ callId: "c1", action: "hack" })).toBeNull();
		expect(parseAnswer({ action: "accept" })).toBeNull();
		expect(parseAnswer(null)).toBeNull();
	});
});

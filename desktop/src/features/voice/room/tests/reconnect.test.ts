import { DisconnectReason } from "livekit-client";
import { describe, expect, it } from "vitest";
import {
	GIVE_UP_MS,
	nextAttempt,
	reconnectDelay,
	shouldReconnect,
} from "../model/reconnect";

describe("a voz volta sozinha", () => {
	it("espera 1, 2, 5, 10, 20 e 30 segundos, e depois a cada 30", () => {
		expect([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelay)).toEqual([
			1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
		]);
	});

	it("desiste depois de 5 minutos", () => {
		expect(nextAttempt({ startedAt: 0, tries: 9 }, GIVE_UP_MS - 1)).toBe(30_000);
		expect(nextAttempt({ startedAt: 0, tries: 9 }, GIVE_UP_MS)).toBeNull();
	});

	it("só a queda que ninguém pediu tenta de novo", () => {
		expect(shouldReconnect(DisconnectReason.SERVER_SHUTDOWN)).toBe(true);
		expect(shouldReconnect(DisconnectReason.SIGNAL_CLOSE)).toBe(true);
		expect(shouldReconnect(undefined)).toBe(true);
		expect(shouldReconnect(DisconnectReason.CLIENT_INITIATED)).toBe(false);
		expect(shouldReconnect(DisconnectReason.PARTICIPANT_REMOVED)).toBe(false);
		expect(shouldReconnect(DisconnectReason.ROOM_DELETED)).toBe(false);
		expect(shouldReconnect(DisconnectReason.DUPLICATE_IDENTITY)).toBe(false);
	});
});

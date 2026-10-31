import { describe, expect, it } from "vitest";
import type { CreatedInviteView } from "@/lib/api";
import {
	forgetQuickInvite,
	isStillValid,
	rememberQuickInvite,
	timeLeft,
	useQuickInviteStore,
} from "../stores/quickInviteStore";

const invite = (expiresAt: number, id = "i1"): CreatedInviteView => ({
	id,
	code: "7KQ2-M9XD-4HPA",
	link: "https://ashtar.exemplo.ts.net/invite/7KQ2-M9XD-4HPA",
	expires_at: expiresAt,
	max_uses: 8,
	preset: "group",
});

describe("convite rápido", () => {
	it("vale enquanto falta mais de 30 s", () => {
		const now = 1_000_000_000;
		expect(isStillValid(invite(now / 1000 + 300), now)).toBe(true);
		expect(isStillValid(invite(now / 1000 + 31), now)).toBe(true);
		expect(isStillValid(invite(now / 1000 + 30), now)).toBe(false);
		expect(isStillValid(invite(now / 1000 - 1), now)).toBe(false);
	});

	it("conta o tempo que resta de quando chegou", () => {
		const quick = { invite: invite(400), receivedAt: 100_000 };
		expect(timeLeft(quick, 100_000)).toBe(1);
		expect(timeLeft(quick, 250_000)).toBe(0.5);
		expect(timeLeft(quick, 500_000)).toBe(0);
	});

	it("esquece só o convite revogado", () => {
		rememberQuickInvite(invite(400, "i1"));
		forgetQuickInvite("outro");
		expect(useQuickInviteStore.getState().current?.invite.id).toBe("i1");
		forgetQuickInvite("i1");
		expect(useQuickInviteStore.getState().current).toBeNull();
	});
});

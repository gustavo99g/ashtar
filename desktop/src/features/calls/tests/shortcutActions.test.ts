import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptCall, hangUpCall } from "@/lib/api";
import { acceptRinging, declineOrHangUp } from "../actions";
import { resetCalls, useCallStore } from "../stores/callStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	acceptCall: vi.fn(),
	hangUpCall: vi.fn(async () => {}),
}));

beforeEach(() => {
	vi.clearAllMocks();
	resetCalls();
});

describe("os atalhos da ligação", () => {
	it("sem ligação tocando, atender e recusar não fazem nada", async () => {
		await acceptRinging();
		await declineOrHangUp();
		expect(acceptCall).not.toHaveBeenCalled();
		expect(hangUpCall).not.toHaveBeenCalled();
	});

	it("tocando, recusa; chamando, desiste; na ligação, desliga", async () => {
		const call = { channel_id: "dm-1" };
		for (const [phase, reason] of [
			["ringing", "decline"],
			["calling", "cancel"],
			["in_call", "end"],
		] as const) {
			useCallStore.setState({ call, phase } as never);
			await declineOrHangUp();
			expect(hangUpCall).toHaveBeenLastCalledWith("dm-1", reason);
		}
	});
});

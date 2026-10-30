import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, UpdateChannel } from "@/lib/api";
import { setUpdateChannel } from "@/lib/tauri/commands";
import { useUpdateChannelSync } from "../useUpdateChannelSync";

vi.mock("@/lib/tauri/commands", () => ({
	setUpdateChannel: vi.fn(() => Promise.resolve()),
}));

let me: Pick<MeResponse, "update_channel"> | undefined;
vi.mock("@/features/identity", () => ({ useMe: () => ({ data: me }) }));

function answer(channel: UpdateChannel) {
	me = { update_channel: channel };
}

beforeEach(() => {
	me = undefined;
	vi.mocked(setUpdateChannel).mockClear();
});

describe("useUpdateChannelSync", () => {
	it("sem o /api/me, não chama o Rust", () => {
		renderHook(() => useUpdateChannelSync());
		expect(setUpdateChannel).not.toHaveBeenCalled();
	});

	it("passa o canal que a API mandou, e de novo só quando ele muda", () => {
		answer("stable");
		const { rerender } = renderHook(() => useUpdateChannelSync());
		expect(setUpdateChannel).toHaveBeenLastCalledWith("stable");

		rerender();
		expect(setUpdateChannel).toHaveBeenCalledTimes(1);

		answer("beta");
		rerender();
		expect(setUpdateChannel).toHaveBeenLastCalledWith("beta");
		expect(setUpdateChannel).toHaveBeenCalledTimes(2);
	});

	it("uma falha do comando não vira erro na tela", async () => {
		vi.mocked(setUpdateChannel).mockRejectedValueOnce({
			kind: "Internal",
			message: "x",
		});
		answer("beta");
		renderHook(() => useUpdateChannelSync());
		await Promise.resolve();
		expect(setUpdateChannel).toHaveBeenCalledTimes(1);
	});
});

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import type { ScreenShareState } from "@/features/screen-share";
import type { CaptureSource, GameView } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import { useFollowGameWindow } from "../hooks/useFollowGameWindow";

vi.mock("@/components/ui/toast", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/ui/toast")>()),
	toast: { add: vi.fn() },
}));

function game(pid: number, name = "League of Legends"): GameView {
	return {
		id: `jogo-${pid}`,
		name,
		exe: `C:\\Riot Games\\${pid}.exe`,
		source: "installed",
		pid,
		startedMs: 0,
		icon: null,
	};
}

function window(processId: number, id: number): CaptureSource {
	return {
		source: { kind: "window", id },
		title: `Janela ${processId}`,
		processId,
		icon: null,
		monitor: null,
		minimized: false,
	};
}

function sharing(processId: number): ScreenShareState {
	return {
		status: "active",
		sessionId: 1,
		startedAt: 0,
		source: window(processId, 1),
		quality: "1080p60",
		audioMode: { mode: "off" },
		cursor: true,
		leveler: true,
		paused: false,
		audio: "off",
		link: "ok",
	};
}

afterEach(() => vi.clearAllMocks());

describe("a transmissão segue o jogo", () => {
	it("do cliente para a partida do mesmo jogo, trocando a fonte", async () => {
		const controller = fakeShareController(sharing(10), [
			window(10, 1),
			window(20, 2),
		]);
		const { rerender } = renderHook(
			({ current }) => useFollowGameWindow(controller, sharing(10), current),
			{ initialProps: { current: game(10) } },
		);
		expect(controller.update).not.toHaveBeenCalled();

		rerender({ current: game(20) });
		await waitFor(() =>
			expect(controller.update).toHaveBeenCalledWith({
				kind: "source",
				source: window(20, 2),
			}),
		);
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "A transmissão foi para a nova janela de League of Legends",
			}),
		);
	});

	it("outro jogo, ou uma fonte que não é do jogo, fica onde está", async () => {
		const controller = fakeShareController(sharing(10), [
			window(10, 1),
			window(30, 3),
			window(77, 7),
		]);
		const { rerender } = renderHook(
			({ current, state }) => useFollowGameWindow(controller, state, current),
			{ initialProps: { current: game(10), state: sharing(10) } },
		);
		rerender({ current: game(30, "Hades"), state: sharing(10) });
		// Transmitindo uma janela que nunca foi do cartão.
		rerender({ current: game(20), state: sharing(77) });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(controller.update).not.toHaveBeenCalled();
	});
});

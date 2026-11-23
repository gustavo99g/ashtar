import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import type { ScreenShareState } from "@/features/screen-share";
import type { CaptureSource, GameView } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import {
	FOLLOW_DELAY_MS,
	useFollowGameWindow,
} from "../hooks/useFollowGameWindow";

vi.mock("@/components/ui/toast", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/ui/toast")>()),
	toast: { add: vi.fn() },
}));

function game(pid: number, family: number[], name = "League of Legends"): GameView {
	return {
		id: `jogo-${pid}`,
		name,
		exe: `C:\\Riot Games\\${pid}.exe`,
		source: "installed",
		pid,
		startedMs: 0,
		icon: null,
		family,
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

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("a transmissão segue o jogo", () => {
	it("vai para a partida e fica nela, mesmo com o cliente na frente", async () => {
		const controller = fakeShareController(sharing(10), [
			window(10, 1),
			window(20, 2),
		]);
		const { rerender } = renderHook(
			({ current, state }) => useFollowGameWindow(controller, state, current),
			{ initialProps: { current: game(10, [10]), state: sharing(10) } },
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(controller.update).not.toHaveBeenCalled();

		// A partida (20) abriu: a transmissão vai para ela uns segundos depois.
		vi.useFakeTimers();
		rerender({ current: game(20, [20, 10]), state: sharing(10) });
		await vi.advanceTimersByTimeAsync(FOLLOW_DELAY_MS - 100);
		expect(controller.update).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200);
		vi.useRealTimers();
		await waitFor(() =>
			expect(controller.update).toHaveBeenCalledWith({
				kind: "source",
				source: window(20, 2),
			}),
		);
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "A transmissão foi para a outra janela de League of Legends",
			}),
		);

		// O cliente voltou para a frente: a partida ainda está aberta, então fica nela.
		vi.mocked(controller.update).mockClear();
		rerender({ current: game(10, [20, 10]), state: sharing(20) });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(controller.update).not.toHaveBeenCalled();
	});

	it("a partida fechou e levou a transmissão: começa de novo no cliente", async () => {
		const sources = [window(20, 2), window(10, 1)];
		const controller = fakeShareController({ status: "idle" }, sources);
		const { rerender } = renderHook(
			({ current, state }) => useFollowGameWindow(controller, state, current),
			{ initialProps: { current: game(20, [20, 10]), state: sharing(20) } },
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		// A janela da partida sumiu junto com a transmissão.
		sources.shift();
		rerender({
			current: game(20, [20, 10]),
			state: { status: "idle", ended: "sourceClosed" },
		});
		await waitFor(() => expect(controller.start).toHaveBeenCalledTimes(1));
		const [request] = vi.mocked(controller.start).mock.calls[0] as unknown as [
			{ source: CaptureSource },
		];
		expect(request.source).toEqual(window(10, 1));
	});

	it("parar à mão, ou transmitir o que não é do jogo, fica como está", async () => {
		const controller = fakeShareController({ status: "idle" }, [
			window(10, 1),
			window(20, 2),
			window(77, 7),
		]);
		const { rerender } = renderHook(
			({ current, state }) => useFollowGameWindow(controller, state, current),
			{ initialProps: { current: game(20, [20, 10]), state: sharing(77) } },
		);
		rerender({ current: game(20, [20, 10]), state: sharing(20) });
		rerender({ current: game(20, [20, 10]), state: { status: "idle" } });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(controller.update).not.toHaveBeenCalled();
		expect(controller.start).not.toHaveBeenCalled();
	});
});

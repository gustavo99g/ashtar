import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMaybeVoice } from "@/features/voice";
import { sendRealtime, useRealtimeOpen } from "@/lib/realtime";
import { idleSeconds } from "@/lib/tauri/commands";
import {
	IDLE_AFTER_SECONDS,
	IDLE_POLL_MS,
	useIdleReporter,
} from "../hooks/useIdleReporter";

vi.mock("@/features/voice", () => ({ useMaybeVoice: vi.fn() }));
vi.mock("@/lib/realtime", () => ({
	sendRealtime: vi.fn(() => true),
	useRealtimeOpen: vi.fn(() => true),
}));
vi.mock("@/lib/tauri/commands", () => ({ idleSeconds: vi.fn() }));

/** Deixa a olhada (assíncrona) terminar. */
async function settle() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(useMaybeVoice).mockReturnValue(null);
	vi.mocked(useRealtimeOpen).mockReturnValue(true);
	vi.mocked(idleSeconds).mockResolvedValue(0);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("o Ausente automático", () => {
	it("avisa só quando muda: dez minutos parado e o primeiro toque", async () => {
		renderHook(() => useIdleReporter());
		await settle();
		expect(sendRealtime).not.toHaveBeenCalled();

		vi.mocked(idleSeconds).mockResolvedValue(IDLE_AFTER_SECONDS);
		await act(() => vi.advanceTimersByTimeAsync(IDLE_POLL_MS));
		expect(sendRealtime).toHaveBeenLastCalledWith({ type: "idle", idle: true });

		// Continua parado: nada de novo.
		await act(() => vi.advanceTimersByTimeAsync(IDLE_POLL_MS));
		expect(sendRealtime).toHaveBeenCalledTimes(1);

		vi.mocked(idleSeconds).mockResolvedValue(3);
		await act(() => vi.advanceTimersByTimeAsync(IDLE_POLL_MS));
		expect(sendRealtime).toHaveBeenLastCalledWith({
			type: "idle",
			idle: false,
		});
	});

	it("numa sala de voz, ninguém fica ausente", async () => {
		vi.mocked(useMaybeVoice).mockReturnValue({
			voiceKind: "room",
			connectionState: "connected",
		} as ReturnType<typeof useMaybeVoice>);
		vi.mocked(idleSeconds).mockResolvedValue(IDLE_AFTER_SECONDS * 3);
		renderHook(() => useIdleReporter());
		await settle();
		await act(() => vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2));
		expect(sendRealtime).not.toHaveBeenCalled();
	});

	it("o socket que volta recebe o Ausente de novo", async () => {
		vi.mocked(idleSeconds).mockResolvedValue(IDLE_AFTER_SECONDS);
		const { rerender } = renderHook(() => useIdleReporter());
		await settle();
		expect(sendRealtime).toHaveBeenCalledTimes(1);

		vi.mocked(useRealtimeOpen).mockReturnValue(false);
		rerender();
		vi.mocked(useRealtimeOpen).mockReturnValue(true);
		rerender();
		expect(sendRealtime).toHaveBeenCalledTimes(2);
		expect(sendRealtime).toHaveBeenLastCalledWith({ type: "idle", idle: true });
	});
});

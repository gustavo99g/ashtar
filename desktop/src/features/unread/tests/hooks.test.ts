import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markRead, type ReadState } from "@/lib/api";
import { useAppFocused } from "@/lib/visibility";
import { MARK_READ_DELAY_MS, useMarkRead } from "../hooks/useMarkRead";
import { useUnreadMarker } from "../hooks/useUnreadMarker";
import { applyState, EMPTY_STATE, useUnreadStore } from "../store";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	markRead: vi.fn(),
}));
vi.mock("@/lib/visibility", () => ({ useAppFocused: vi.fn() }));

function state(overrides: Partial<ReadState> = {}): ReadState {
	return { ...EMPTY_STATE, ...overrides };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(useAppFocused).mockReturnValue(true);
	vi.mocked(markRead).mockReset();
	vi.mocked(markRead).mockImplementation(async (_, { message_id }) =>
		state({ last_read_id: message_id }),
	);
	useUnreadStore.setState({
		me: "kid",
		byChannel: { geral: state({ last_read_id: "m1", unread: 2 }) },
		newest: { geral: "m3" },
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useMarkRead", () => {
	function mount(last: string, seeingEnd = true) {
		return renderHook(
			({ last, seeingEnd }) => useMarkRead("geral", last, seeingEnd),
			{ initialProps: { last, seeingEnd } },
		);
	}

	it("lendo (em foco e no fim), marca depois de um segundo", async () => {
		mount("m3");
		await act(() => vi.advanceTimersByTimeAsync(MARK_READ_DELAY_MS - 1));
		expect(markRead).not.toHaveBeenCalled();
		await act(() => vi.advanceTimersByTimeAsync(1));
		expect(markRead).toHaveBeenCalledWith("geral", { message_id: "m3" });
		expect(useUnreadStore.getState().byChannel.geral.unread).toBe(0);
	});

	it("mensagens seguidas saem num pedido só, com a mais nova", async () => {
		const view = mount("m3");
		await act(() => vi.advanceTimersByTimeAsync(600));
		view.rerender({ last: "m4", seeingEnd: true });
		await act(() => vi.advanceTimersByTimeAsync(600));
		view.rerender({ last: "m5", seeingEnd: true });
		await act(() => vi.advanceTimersByTimeAsync(MARK_READ_DELAY_MS));
		expect(markRead).toHaveBeenCalledTimes(1);
		expect(markRead).toHaveBeenCalledWith("geral", { message_id: "m5" });
	});

	it("sem foco, ou longe do fim, não marca; voltando, marca", async () => {
		vi.mocked(useAppFocused).mockReturnValue(false);
		const view = mount("m3");
		await act(() => vi.advanceTimersByTimeAsync(5_000));
		vi.mocked(useAppFocused).mockReturnValue(true);
		view.rerender({ last: "m3", seeingEnd: false });
		await act(() => vi.advanceTimersByTimeAsync(5_000));
		expect(markRead).not.toHaveBeenCalled();

		view.rerender({ last: "m3", seeingEnd: true });
		await act(() => vi.advanceTimersByTimeAsync(MARK_READ_DELAY_MS));
		expect(markRead).toHaveBeenCalledTimes(1);
	});

	it("já lido até ali, não pede nada", async () => {
		mount("m1");
		await act(() => vi.advanceTimersByTimeAsync(5_000));
		expect(markRead).not.toHaveBeenCalled();
	});
});

describe("useUnreadMarker", () => {
	it("abrindo com não lidas, a linha fica no ponteiro e não anda depois de lido", () => {
		const view = renderHook(() => useUnreadMarker("geral", true));
		expect(view.result.current).toBe("m1");
		act(() => applyState("geral", state({ last_read_id: "m3" })));
		expect(view.result.current).toBe("m1");
	});

	it("sem não lidas ao abrir, mensagem chegando enquanto lê não cria linha", () => {
		applyState("geral", state({ last_read_id: "m3" }));
		const view = renderHook(() => useUnreadMarker("geral", true));
		act(() => applyState("geral", state({ last_read_id: "m3", unread: 1 })));
		expect(view.result.current).toBeUndefined();
	});

	it("chegando sem estar lendo, cria a linha no ponteiro", () => {
		applyState("geral", state({ last_read_id: "m3" }));
		const view = renderHook(() => useUnreadMarker("geral", false));
		expect(view.result.current).toBeUndefined();
		act(() => applyState("geral", state({ last_read_id: "m3", unread: 1 })));
		expect(view.result.current).toBe("m3");
	});
});

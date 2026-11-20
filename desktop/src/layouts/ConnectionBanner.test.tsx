import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeStatus } from "@/lib/realtime";
import { ConnectionBanner, SHOW_AFTER_MS } from "./ConnectionBanner";

const realtime = vi.hoisted(() => ({
	status: "open" as RealtimeStatus,
	retryAt: null as number | null,
	retryNow: vi.fn(),
}));
vi.mock("@/lib/realtime", () => ({
	useRealtimeStatus: () => realtime.status,
	useRealtimeRetryAt: () => realtime.retryAt,
	retryRealtimeNow: realtime.retryNow,
}));

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	realtime.status = "open";
	realtime.retryAt = null;
});
afterEach(() => {
	vi.useRealTimers();
});

describe("a faixa Sem conexão com o servidor", () => {
	it("quedas curtas não mostram nada", () => {
		const { rerender } = render(<ConnectionBanner />);
		realtime.status = "reconnecting";
		rerender(<ConnectionBanner />);
		act(() => vi.advanceTimersByTime(SHOW_AFTER_MS - 100));
		realtime.status = "open";
		rerender(<ConnectionBanner />);
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("depois de 5 s, conta a próxima tentativa e tenta agora", async () => {
		const { rerender } = render(<ConnectionBanner />);
		realtime.status = "reconnecting";
		realtime.retryAt = Date.now() + SHOW_AFTER_MS + 8000;
		rerender(<ConnectionBanner />);
		act(() => vi.advanceTimersByTime(SHOW_AFTER_MS));

		expect(screen.getByText("Sem conexão com o servidor")).toBeInTheDocument();
		expect(screen.getByText("Tentando de novo em 8 s")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Tentar agora" }));
		expect(realtime.retryNow).toHaveBeenCalled();

		realtime.status = "open";
		rerender(<ConnectionBanner />);
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});
});

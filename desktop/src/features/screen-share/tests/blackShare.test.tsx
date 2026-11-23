import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { blackWatchStart, blackWatchStop } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import {
	BlackShareBand,
	BlackShareWatch,
	resetBlackWarnings,
} from "../components/BlackShareWatch";
import type { ScreenShareState } from "../model/controller";

vi.mock("@/components/ui/toast", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/ui/toast")>()),
	toast: { add: vi.fn() },
}));

let report: ((black: boolean) => void) | null = null;
vi.mock("@/lib/tauri/commands", async (importOriginal) => ({
	...(await importOriginal<object>()),
	blackWatchStart: vi.fn(async (_source, onChange: (black: boolean) => void) => {
		report = onChange;
		return 5;
	}),
	blackWatchStop: vi.fn(async () => {}),
}));

function active(sessionId: number, paused = false): ScreenShareState {
	return {
		status: "active",
		sessionId,
		startedAt: 0,
		source: {
			source: { kind: "window", id: 7 },
			title: "Filme",
			processId: 1,
			icon: null,
			monitor: null,
			minimized: false,
		},
		quality: "1080p60",
		audioMode: { mode: "off" },
		cursor: true,
		leveler: true,
		paused,
		audio: "off",
		link: "ok",
	};
}

function renderWatch(state: ScreenShareState) {
	return render(
		<>
			<BlackShareWatch controller={fakeShareController(state)} />
			<BlackShareBand />
		</>,
	);
}

afterEach(() => {
	report = null;
	resetBlackWarnings();
	vi.clearAllMocks();
});

describe("aviso de tela preta", () => {
	it("pausada ou parada, não confere", () => {
		renderWatch(active(1, true));
		renderWatch({ status: "idle" });
		expect(blackWatchStart).not.toHaveBeenCalled();
	});

	it("saindo preta: o aviso uma vez por transmissão e a faixa enquanto durar", async () => {
		const { unmount } = renderWatch(active(1));
		await waitFor(() => expect(blackWatchStart).toHaveBeenCalledTimes(1));

		act(() => report?.(true));
		expect(screen.getByText("Saindo preta")).toBeInTheDocument();
		expect(toast.add).toHaveBeenCalledTimes(1);
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Sua transmissão está saindo preta" }),
		);

		// Voltou a imagem: a faixa some. Preta de novo na mesma transmissão: sem outro aviso.
		act(() => report?.(false));
		expect(screen.queryByText("Saindo preta")).not.toBeInTheDocument();
		act(() => report?.(true));
		expect(toast.add).toHaveBeenCalledTimes(1);

		unmount();
		expect(blackWatchStop).toHaveBeenCalledWith(5);
		expect(screen.queryByText("Saindo preta")).not.toBeInTheDocument();
	});

	it("uma transmissão nova avisa de novo", async () => {
		const first = renderWatch(active(1));
		await waitFor(() => expect(blackWatchStart).toHaveBeenCalled());
		act(() => report?.(true));
		first.unmount();

		renderWatch(active(2));
		await waitFor(() => expect(blackWatchStart).toHaveBeenCalledTimes(2));
		act(() => report?.(true));
		expect(toast.add).toHaveBeenCalledTimes(2);
	});
});

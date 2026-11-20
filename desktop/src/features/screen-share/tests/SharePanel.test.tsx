import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaptureSource, ShareStats } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import { SharePanel } from "../components/SharePanel";
import type { ScreenShareState } from "../model/controller";
import { usePickerStore } from "../stores/pickerStore";
import { setShareViewers } from "../stores/viewersStore";

vi.mock("@/lib/tauri/commands", () => ({
	thumbnailsStart: vi.fn(async () => 1),
	thumbnailsUpdate: vi.fn(async () => {}),
	thumbnailsStop: vi.fn(async () => {}),
}));

const source: CaptureSource = {
	source: { kind: "window", id: 5 },
	title: "Jogo",
	processId: 9,
	icon: null,
	monitor: null,
	minimized: false,
};
const active: ScreenShareState = {
	status: "active",
	sessionId: 7,
	startedAt: Date.now() - 65_000,
	source,
	quality: "1080p60",
	audioMode: { mode: "application", processId: 9 },
	cursor: true,
	leveler: true,
	paused: false,
	link: "ok",
	audio: "on",
};

function stats(targetKbps: number, dropped = 0): ShareStats {
	return {
		sessionId: 7,
		encoder: { kind: "hardware", name: "AMDh264Encoder" },
		adapter: "AMD",
		width: 1920,
		height: 1080,
		fps: 60,
		bitrateKbps: 7_500,
		targetKbps,
		latencyMs: 6,
		keyframes: 1,
		dropped,
		paused: false,
	};
}

function renderPanel(controller = fakeShareController(active), ping = 42) {
	render(
		<SharePanel controller={controller} open onClose={() => {}} ping={ping} />,
	);
	return controller;
}

describe("SharePanel", () => {
	it("mostra os números em cartões, o tempo no ar e quem está assistindo, há quanto tempo", () => {
		const controller = fakeShareController(active);
		const numbers = stats(8_000);
		controller.getStats = () => numbers;
		const now = Date.now();
		setShareViewers([
			{ id: "u1", name: "Juju", since: now - 12 * 60_000 },
			{ id: "u2", name: "Kid", since: now },
		]);
		renderPanel(controller);

		expect(screen.getByText("1920×1080")).toBeInTheDocument();
		expect(screen.getByText("60 de 60 fps")).toBeInTheDocument();
		expect(screen.getByText("7,5 Mbps")).toBeInTheDocument();
		expect(screen.getByText("AMDh264Encoder")).toBeInTheDocument();
		expect(screen.getByText("42 ms")).toBeInTheDocument();
		expect(screen.getByText("1:05")).toBeInTheDocument();
		expect(screen.getByText("2 assistindo")).toBeInTheDocument();
		expect(screen.getByText("há 12 min")).toBeInTheDocument();
		expect(screen.getByText("agora")).toBeInTheDocument();
		expect(screen.getByText(/^Tudo certo/)).toBeInTheDocument();
		expect(
			screen.getByRole("img", { name: /Envio no último minuto/ }),
		).toBeInTheDocument();
		setShareViewers([]);
	});

	it("avisa quando a rede pede bem menos que o preset", () => {
		const controller = fakeShareController(active);
		const numbers = stats(3_000);
		controller.getStats = () => numbers;
		renderPanel(controller);

		expect(screen.getByText(/segurando a transmissão/)).toBeInTheDocument();
	});

	it("avisa do computador no limite quando quadros ficam para trás, e não pelo fps", () => {
		const controller = fakeShareController(active);
		let numbers = { ...stats(8_000), fps: 4 };
		const listeners = new Set<() => void>();
		controller.getStats = () => numbers;
		controller.onStats = ((listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}) as never;
		renderPanel(controller);

		// A tela parada derruba o fps sem nada de errado.
		expect(screen.getByText(/^Tudo certo/)).toBeInTheDocument();

		numbers = { ...stats(8_000, 3), fps: 60 };
		act(() => {
			for (const listener of listeners) listener();
		});
		expect(screen.getByText(/computador está no limite/)).toBeInTheDocument();
	});

	it("os ajustes vão para o controller", async () => {
		const controller = renderPanel();

		await userEvent.click(screen.getByRole("radio", { name: "Nitidez" }));
		await userEvent.click(screen.getByRole("radio", { name: "Do sistema" }));
		await userEvent.click(screen.getByRole("button", { name: "Pausar" }));

		expect(controller.update.mock.calls).toEqual([
			[{ kind: "quality", quality: "1080p30" }],
			[{ kind: "audio", audio: { mode: "system" } }],
			[{ kind: "paused", paused: true }],
		]);
	});

	it("um ajuste que falha avisa, e a transmissão segue", async () => {
		const controller = fakeShareController(active);
		controller.update.mockRejectedValue({
			kind: "AudioCapture",
			message: "não abriu",
		});
		renderPanel(controller);

		await userEvent.click(screen.getByRole("radio", { name: "Do sistema" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("não abriu");
		expect(controller.stop).not.toHaveBeenCalled();
	});

	it("o Trocar fonte abre o seletor no modo de troca", async () => {
		renderPanel();

		await userEvent.click(screen.getByRole("button", { name: "Trocar fonte" }));

		expect(usePickerStore.getState()).toMatchObject({
			open: true,
			mode: "change",
		});
	});

	it("sem transmissão ativa, não abre", () => {
		renderPanel(fakeShareController({ status: "idle" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});

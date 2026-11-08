import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaptureSource, ShareStats } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import { SharePanel } from "../components/SharePanel";
import type { ScreenShareState } from "../model/controller";
import { usePickerStore } from "../stores/pickerStore";

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
	source,
	quality: "1080p60",
	audioMode: { mode: "application", processId: 9 },
	cursor: true,
	paused: false,
	audio: "on",
};

function stats(targetKbps: number): ShareStats {
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
		dropped: 0,
		paused: false,
	};
}

function renderPanel(
	controller = fakeShareController(active),
	viewers = ["Juju"],
) {
	render(
		<SharePanel
			controller={controller}
			open
			onClose={() => {}}
			viewers={viewers}
		/>,
	);
	return controller;
}

describe("SharePanel", () => {
	it("mostra os números, o encoder e quem está assistindo", () => {
		const controller = fakeShareController(active);
		const numbers = stats(8_000);
		controller.getStats = () => numbers;
		renderPanel(controller, ["Juju", "Kid"]);

		expect(screen.getByText("1920 × 1080, 60 fps")).toBeInTheDocument();
		expect(screen.getByText("AMDh264Encoder")).toBeInTheDocument();
		expect(screen.getByText("2 assistindo")).toBeInTheDocument();
		expect(screen.getByText("Juju, Kid")).toBeInTheDocument();
		expect(
			screen.queryByText(/segurando a transmissão/),
		).not.toBeInTheDocument();
	});

	it("avisa quando a rede pede bem menos que o preset", () => {
		const controller = fakeShareController(active);
		const numbers = stats(3_000);
		controller.getStats = () => numbers;
		renderPanel(controller);

		expect(screen.getByText(/segurando a transmissão/)).toBeInTheDocument();
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

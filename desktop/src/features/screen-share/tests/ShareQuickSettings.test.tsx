import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaptureSource, ShareStats } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import { ShareQuickSettings } from "../components/ShareQuickSettings";
import type { ScreenShareState } from "../model/controller";
import { usePickerStore } from "../stores/pickerStore";
import { setShareViewers } from "../stores/viewersStore";

const source: CaptureSource = {
	source: { kind: "window", id: 5 },
	title: "CS2",
	processId: 9,
	icon: null,
	monitor: null,
	minimized: false,
};
const active: ScreenShareState = {
	status: "active",
	sessionId: 7,
	startedAt: Date.now() - 125_000,
	source,
	quality: "720p60",
	audioMode: { mode: "application", processId: 9 },
	cursor: true,
	leveler: true,
	paused: false,
	link: "ok",
	audio: "on",
};
const numbers: ShareStats = {
	sessionId: 7,
	encoder: { kind: "hardware", name: "AMDh264Encoder" },
	adapter: "AMD",
	width: 1280,
	height: 720,
	fps: 60,
	bitrateKbps: 3_200,
	targetKbps: 4_000,
	latencyMs: 18,
	keyframes: 1,
	dropped: 0,
	paused: false,
};

describe("ShareQuickSettings", () => {
	it("mostra a fonte, o tempo no ar, quem assiste e a linha dos números", () => {
		const controller = fakeShareController(active);
		controller.getStats = () => numbers;
		setShareViewers([{ id: "u1", name: "Juju", since: 0 }]);
		render(<ShareQuickSettings controller={controller} onClose={() => {}} />);

		expect(screen.getByText("Janela: CS2")).toBeInTheDocument();
		expect(screen.getByText("2:05")).toBeInTheDocument();
		expect(screen.getByText(/1 assistindo/)).toBeInTheDocument();
		expect(
			screen.getByText("720p · 60 fps · 3,2 Mbps · 18 ms"),
		).toBeInTheDocument();
		setShareViewers([]);
	});

	it("os ajustes vão para o controller, e o áudio tem os rótulos curtos", async () => {
		const controller = fakeShareController(active);
		render(<ShareQuickSettings controller={controller} onClose={() => {}} />);

		await userEvent.click(screen.getByRole("radio", { name: "Movimento" }));
		await userEvent.click(screen.getByRole("radio", { name: "Sistema" }));
		await userEvent.click(screen.getByRole("button", { name: "Pausar" }));

		expect(controller.update.mock.calls).toEqual([
			[{ kind: "quality", quality: "1080p60" }],
			[{ kind: "audio", audio: { mode: "system" } }],
			[{ kind: "paused", paused: true }],
		]);
	});

	it("a chave Nivelar o volume vai para o controller, e fica desligada sem áudio", async () => {
		const controller = fakeShareController(active);
		const { unmount } = render(
			<ShareQuickSettings controller={controller} onClose={() => {}} />,
		);

		const leveler = screen.getByRole("switch", { name: "Nivelar o volume" });
		expect(leveler).toBeChecked();
		await userEvent.click(leveler);
		expect(controller.update.mock.calls).toEqual([
			[{ kind: "leveler", enabled: false }],
		]);
		unmount();

		render(
			<ShareQuickSettings
				controller={fakeShareController({
					...active,
					audioMode: { mode: "off" },
					audio: "off",
				})}
				onClose={() => {}}
			/>,
		);
		// O Switch é um `span`: o desligado vem no `aria-disabled`.
		expect(
			screen.getByRole("switch", { name: "Nivelar o volume" }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("Detalhes fecha o popover e abre o painel; Trocar abre o seletor no modo de troca", async () => {
		const onClose = vi.fn();
		render(
			<ShareQuickSettings
				controller={fakeShareController(active)}
				onClose={onClose}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Detalhes" }));
		expect(usePickerStore.getState().panelOpen).toBe(true);

		await userEvent.click(screen.getByRole("button", { name: "Trocar" }));
		expect(usePickerStore.getState()).toMatchObject({
			open: true,
			mode: "change",
		});
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("pausada, diz que nada está indo e oferece Continuar", () => {
		render(
			<ShareQuickSettings
				controller={fakeShareController({
					...active,
					paused: true,
				} as ScreenShareState)}
				onClose={() => {}}
			/>,
		);
		expect(screen.getByText(/nada está indo/)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Continuar" }),
		).toBeInTheDocument();
	});

	it("Parar fecha o popover e para a transmissão", async () => {
		const controller = fakeShareController(active);
		const onClose = vi.fn();
		render(<ShareQuickSettings controller={controller} onClose={onClose} />);

		await userEvent.click(screen.getByRole("button", { name: "Parar" }));

		expect(onClose).toHaveBeenCalledOnce();
		expect(controller.stop).toHaveBeenCalledOnce();
	});
});

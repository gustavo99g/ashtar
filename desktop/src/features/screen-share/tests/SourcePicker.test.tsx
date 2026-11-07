import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaptureSource } from "@/lib/tauri/commands";
import type { ScreenShareController } from "../model/controller";
import { SourcePicker } from "../components/SourcePicker";

const sources: CaptureSource[] = [
	{
		source: { kind: "window", id: 1 },
		title: "Navegador",
		processId: 7,
		icon: null,
		monitor: null,
	},
	{
		source: { kind: "monitor", id: 10 },
		title: "Tela 1 (principal)",
		processId: null,
		icon: null,
		monitor: { x: 0, y: 0, width: 2560, height: 1440, isPrimary: true },
	},
	{
		source: { kind: "monitor", id: 11 },
		title: "Tela 2",
		processId: null,
		icon: null,
		monitor: { x: 2560, y: 0, width: 1920, height: 1080, isPrimary: false },
	},
];

function fakeController() {
	return {
		getState: () => ({ status: "idle" }),
		onStateChange: () => () => {},
		listSources: vi.fn(async () => sources),
		start: vi.fn(async () => {}),
		stop: async () => {},
		dispose: async () => {},
	} satisfies ScreenShareController;
}

describe("SourcePicker", () => {
	it("compartilha a janela escolhida com o áudio dela", async () => {
		const controller = fakeController();
		const onClose = vi.fn();
		render(
			<SourcePicker
				controller={controller}
				channelName="Jogatina"
				open
				onClose={onClose}
			/>,
		);

		await userEvent.click(
			await screen.findByRole("button", { name: "Navegador" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Compartilhar" }));

		expect(controller.start).toHaveBeenCalledWith({
			source: sources[0],
			quality: "720p60",
			audio: { mode: "application", processId: 7 },
		});
		expect(onClose).toHaveBeenCalled();
	});

	it("desenha as telas com o número da lista e a principal marcada", async () => {
		const controller = fakeController();
		render(
			<SourcePicker
				controller={controller}
				channelName="Jogatina"
				open
				onClose={() => {}}
			/>,
		);

		await userEvent.click(screen.getByRole("tab", { name: "Telas" }));
		const second = await screen.findByRole("button", {
			name: "Tela 2, 1920 × 1080",
		});

		expect(second).toHaveTextContent("2");
		expect(second).not.toHaveTextContent("Principal");
		expect(
			screen.getByRole("button", { name: "Tela 1 (principal), 2560 × 1440" }),
		).toHaveTextContent("Principal");
	});

	it("mostra a descrição do preset escolhido, sem prometer fps", async () => {
		render(
			<SourcePicker
				controller={fakeController()}
				channelName="Jogatina"
				open
				onClose={() => {}}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /Nitidez/ }));

		expect(
			screen.getByText("Para código e documentos: prioriza a leitura do texto."),
		).toBeInTheDocument();
		// O app não promete fps: o que a máquina entrega depende do jogo e do computador.
		expect(screen.queryByText(/fps/i)).not.toBeInTheDocument();
	});
});

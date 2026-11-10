import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CaptureSource,
	type Thumbnail,
	thumbnailsStart,
	thumbnailsStop,
	thumbnailsUpdate,
} from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import { SourcePicker } from "../components/SourcePicker";

vi.mock("@/lib/tauri/commands", () => ({
	thumbnailsStart: vi.fn(),
	thumbnailsUpdate: vi.fn(async () => {}),
	thumbnailsStop: vi.fn(async () => {}),
}));

/** O que o Rust manda pelo `Channel`, para o teste disparar. */
let sendThumbnail: (thumbnail: Thumbnail) => void = () => {};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(thumbnailsStart).mockImplementation(
		async (_sources, onThumbnail) => {
			sendThumbnail = onThumbnail;
			return 3;
		},
	);
	URL.createObjectURL = vi.fn(() => "blob:miniatura");
	URL.revokeObjectURL = vi.fn();
});

const sources: CaptureSource[] = [
	{
		source: { kind: "window", id: 1 },
		title: "Navegador",
		processId: 7,
		icon: null,
		monitor: null,
		minimized: false,
	},
	{
		source: { kind: "window", id: 2 },
		title: "Jogo",
		processId: 8,
		icon: null,
		monitor: null,
		minimized: true,
	},
	{
		source: { kind: "monitor", id: 10 },
		title: "Tela 1 (principal)",
		processId: null,
		icon: null,
		monitor: { x: 0, y: 0, width: 2560, height: 1440, isPrimary: true },
		minimized: false,
	},
	{
		source: { kind: "monitor", id: 11 },
		title: "Tela 2",
		processId: null,
		icon: null,
		monitor: { x: 2560, y: 0, width: 1920, height: 1080, isPrimary: false },
		minimized: false,
	},
];

function fakeController() {
	return fakeShareController({ status: "idle" }, sources);
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
			quality: "1080p60",
			audio: { mode: "application", processId: 7 },
			cursor: true,
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
			screen.getByText(
				"Para código e documentos: mais bits por quadro, texto mais limpo.",
			),
		).toBeInTheDocument();
		// O app não promete fps: o que a máquina entrega depende do jogo e do computador.
		expect(screen.queryByText(/fps/i)).not.toBeInTheDocument();
	});

	it("sem o cursor, o pedido vai sem ele", async () => {
		const controller = fakeController();
		render(
			<SourcePicker
				controller={controller}
				channelName="Jogatina"
				open
				onClose={() => {}}
			/>,
		);

		await userEvent.click(
			await screen.findByRole("button", { name: "Navegador" }),
		);
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Mostrar o cursor" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Compartilhar" }));

		expect(controller.start).toHaveBeenCalledWith(
			expect.objectContaining({ cursor: false }),
		);
	});

	it("a janela minimizada aparece com o selo e não pede miniatura", async () => {
		render(
			<SourcePicker
				controller={fakeController()}
				channelName="Jogatina"
				open
				onClose={() => {}}
			/>,
		);

		expect(
			await screen.findByRole("button", { name: "Jogo, minimizada" }),
		).toHaveTextContent("Minimizada");
		// Começa antes de os cards aparecerem; as fontes à vista chegam pela troca.
		await vi.waitFor(() =>
			expect(thumbnailsUpdate).toHaveBeenLastCalledWith(3, [
				{ kind: "window", id: 1 },
			]),
		);
	});

	it("mostra a imagem ao vivo que chega do Rust e para ao fechar", async () => {
		const { unmount } = render(
			<SourcePicker
				controller={fakeController()}
				channelName="Jogatina"
				open
				onClose={() => {}}
			/>,
		);
		const card = await screen.findByRole("button", { name: "Navegador" });
		await vi.waitFor(() => expect(thumbnailsStart).toHaveBeenCalled());

		act(() =>
			sendThumbnail({
				source: { kind: "window", id: 1 },
				jpeg: new Uint8Array([1]),
			}),
		);

		expect(card.querySelector('img[src="blob:miniatura"]')).not.toBeNull();
		unmount();
		await vi.waitFor(() => expect(thumbnailsStop).toHaveBeenCalledWith(3));
	});

	it("no modo de troca, troca a fonte da transmissão no ar", async () => {
		const controller = fakeController();
		const onClose = vi.fn();
		render(
			<SourcePicker
				controller={controller}
				channelName="Jogatina"
				open
				mode="change"
				onClose={onClose}
			/>,
		);

		await userEvent.click(
			await screen.findByRole("button", { name: "Navegador" }),
		);
		expect(screen.queryByText("Qualidade")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Trocar" }));

		expect(controller.update).toHaveBeenCalledWith({
			kind: "source",
			source: sources[0],
		});
		expect(controller.start).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it("uma troca que falha avisa e deixa o seletor aberto", async () => {
		const controller = fakeController();
		controller.update.mockRejectedValue({
			kind: "VideoCapture",
			message: "a janela fechou",
		});
		const onClose = vi.fn();
		render(
			<SourcePicker
				controller={controller}
				channelName="Jogatina"
				open
				mode="change"
				onClose={onClose}
			/>,
		);

		await userEvent.click(
			await screen.findByRole("button", { name: "Navegador" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Trocar" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"a janela fechou",
		);
		expect(onClose).not.toHaveBeenCalled();
	});
});

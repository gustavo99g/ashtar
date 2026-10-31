import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceConnectionState } from "@/features/voice";
import {
	installUpdate,
	onUpdateFailed,
	onUpdateReady,
} from "@/lib/tauri/commands";
import { useUpdaterStore } from "../stores/updaterStore";
import { UpdateNotice } from "../components/UpdateNotice";

vi.mock("@/lib/tauri/commands", () => ({
	installUpdate: vi.fn(() => new Promise(() => {})),
	onUpdateReady: vi.fn(() => Promise.resolve(() => {})),
	onUpdateFailed: vi.fn(() => Promise.resolve(() => {})),
	pendingUpdate: vi.fn(() => Promise.resolve(null)),
	setUpdateChannel: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/features/identity", () => ({ useMe: () => ({ data: undefined }) }));

let connectionState: VoiceConnectionState = "disconnected";
vi.mock("@/features/voice", () => ({
	SALA: { id: "sala", name: "Sala" },
	useInCall: () =>
		connectionState !== "disconnected" && connectionState !== "error",
}));

/** O que o Rust manda pelo evento, pela função que o componente registrou. */
function emitReady(version: string) {
	const callback = vi.mocked(onUpdateReady).mock.calls[0][0];
	act(() => callback({ version }));
}

function emitFailed(message: string) {
	const callback = vi.mocked(onUpdateFailed).mock.calls[0][0];
	act(() => callback({ message }));
}

beforeEach(() => {
	connectionState = "disconnected";
	useUpdaterStore.setState({ readyVersion: null, notice: null });
	vi.mocked(onUpdateReady).mockClear();
	vi.mocked(onUpdateFailed).mockClear();
	vi.mocked(installUpdate).mockClear();
});

describe("UpdateNotice", () => {
	it("sem nada baixado, não aparece", () => {
		render(<UpdateNotice />);
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("versão pronta: Reiniciar instala e mostra o Reiniciando", () => {
		render(<UpdateNotice />);
		emitReady("0.2.21");

		expect(screen.getByText("Atualização pronta")).toBeInTheDocument();
		expect(
			screen.getByText(
				"Versão 0.2.21. Ou feche o app: ela é instalada ao sair.",
			),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Reiniciar" }));
		expect(installUpdate).toHaveBeenCalledTimes(1);
		expect(screen.getByText("Reiniciando…")).toBeInTheDocument();
	});

	it("numa chamada, sobe acima da barra e pergunta antes; Depois esconde", () => {
		connectionState = "connected";
		render(<UpdateNotice />);
		emitReady("0.2.21");
		expect(screen.getByRole("status")).toHaveClass("bottom-[94px]");

		fireEvent.click(screen.getByRole("button", { name: "Reiniciar" }));
		expect(
			screen.getByRole("alertdialog", { name: "Reiniciar agora?" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("Você sai da chamada na Sala."),
		).toBeInTheDocument();
		expect(installUpdate).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Depois" }));
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		expect(useUpdaterStore.getState().readyVersion).toBe("0.2.21");
	});

	it("a falha aparece com o texto do Rust e fecha no X", () => {
		render(<UpdateNotice />);
		emitFailed(
			"A assinatura do arquivo não confere. Tentamos de novo mais tarde.",
		);

		expect(screen.getByText("Não deu para atualizar")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
		expect(
			screen.queryByText("Não deu para atualizar"),
		).not.toBeInTheDocument();
	});
});

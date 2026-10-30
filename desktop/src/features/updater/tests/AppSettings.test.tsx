import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettings, useUpdaterStore } from "@/features/updater";
import type { MeResponse } from "@/lib/api";
import {
	checkForUpdateNow,
	installUpdate,
	openLogDir,
} from "@/lib/tauri/commands";

vi.mock("@/lib/tauri/commands", () => ({
	checkForUpdateNow: vi.fn(),
	installUpdate: vi.fn(() => new Promise(() => {})),
	openLogDir: vi.fn(),
	whatsNew: vi.fn(() => Promise.resolve(null)),
}));

let me: MeResponse | undefined;
vi.mock("@/features/identity", () => ({ useMe: () => ({ data: me }) }));
vi.mock("@/features/voice", () => ({
	useVoice: () => ({ connectionState: "disconnected" }),
}));

function meWith(
	isOwner: boolean,
	channel: MeResponse["update_channel"],
): MeResponse {
	return {
		user: { id: "u1", nick: "kid", display_name: null, is_owner: isOwner },
		permissions: [],
		update_channel: channel,
		can_create_invite: isOwner,
		can_view_panel: isOwner,
	};
}

beforeEach(() => {
	me = meWith(true, "beta");
	useUpdaterStore.setState({ readyVersion: null, notice: null });
	vi.mocked(checkForUpdateNow).mockReset();
	vi.mocked(installUpdate).mockClear();
	vi.mocked(openLogDir).mockReset();
});

describe("AppSettings", () => {
	it("o dono vê o beta, com a coroa", () => {
		render(<AppSettings />);
		// O selo ao lado da versão e o nome do canal.
		expect(screen.getAllByText("Beta")).toHaveLength(2);
		expect(screen.getByText("O dono sempre recebe o beta")).toBeInTheDocument();
		expect(
			screen.getByText("Você está na versão mais recente."),
		).toBeInTheDocument();
	});

	it("um membro no estável vê que quem define é o dono", () => {
		me = meWith(false, "stable");
		render(<AppSettings />);
		expect(
			screen.getByText(
				"Você recebe as versões depois que elas passam pelo beta.",
			),
		).toBeInTheDocument();
		expect(screen.getByText("Definido pelo dono do grupo")).toBeInTheDocument();
	});

	it("Procurar atualização mostra o que voltou", async () => {
		let answer: (value: { status: "upToDate" }) => void = () => {};
		vi.mocked(checkForUpdateNow).mockReturnValue(
			new Promise((resolve) => {
				answer = resolve;
			}),
		);
		render(<AppSettings />);

		fireEvent.click(
			screen.getByRole("button", { name: "Procurar atualização" }),
		);
		expect(screen.getByText("Procurando atualização…")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Procurar atualização" }),
		).toBeDisabled();

		await act(async () => answer({ status: "upToDate" }));
		expect(
			screen.getByText("Nenhuma versão nova. Você está em dia."),
		).toBeInTheDocument();
	});

	it("com uma versão pronta, o cartão troca para Reiniciar", () => {
		useUpdaterStore.setState({ readyVersion: "0.2.21" });
		render(<AppSettings />);

		expect(
			screen.getByText(
				"Versão 0.2.21 pronta. Ou feche o app: ela é instalada ao sair.",
			),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Procurar atualização" }),
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Reiniciar" }));
		expect(installUpdate).toHaveBeenCalledTimes(1);
	});

	it("se a pasta não abre, diz onde ela fica", async () => {
		vi.mocked(openLogDir).mockRejectedValue({ kind: "Internal", message: "x" });
		render(<AppSettings />);

		fireEvent.click(screen.getByRole("button", { name: "Abrir pasta" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Não deu para abrir a pasta.",
		);
	});
});

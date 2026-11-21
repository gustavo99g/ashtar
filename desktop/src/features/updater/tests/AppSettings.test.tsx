import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettings, useUpdaterStore } from "@/features/updater";
import type { MeResponse } from "@/lib/api";
import {
	autostartEnabled,
	checkForUpdateNow,
	hardwareAcceleration,
	installUpdate,
	openLogDir,
	restartApp,
	setAutostart,
	setHardwareAcceleration,
} from "@/lib/tauri/commands";

vi.mock("@/lib/tauri/commands", () => ({
	autostartEnabled: vi.fn(),
	setAutostart: vi.fn(),
	hardwareAcceleration: vi.fn(() => Promise.resolve(true)),
	setHardwareAcceleration: vi.fn(() => Promise.resolve()),
	restartApp: vi.fn(),
	checkForUpdateNow: vi.fn(),
	installUpdate: vi.fn(() => new Promise(() => {})),
	openLogDir: vi.fn(),
	whatsNew: vi.fn(() => Promise.resolve(null)),
}));

let me: MeResponse | undefined;
vi.mock("@/features/identity", () => ({ useMe: () => ({ data: me }) }));
vi.mock("@/features/voice", () => ({
	useInCall: () => false,
}));

function meWith(
	isOwner: boolean,
	channel: MeResponse["update_channel"],
): MeResponse {
	return {
		user: { id: "u1", nick: "kid", display_name: null, is_owner: isOwner },
		permissions: [],
		update_channel: channel,
		status: "available",
		can_create_invite: isOwner,
		can_view_panel: isOwner,
		can_manage_channels: isOwner,
		can_move_members: isOwner, can_manage_emojis: false, can_view_logs: false,
	};
}

beforeEach(() => {
	me = meWith(true, "beta");
	useUpdaterStore.setState({ readyVersion: null, notice: null });
	vi.mocked(checkForUpdateNow).mockReset();
	vi.mocked(installUpdate).mockClear();
	vi.mocked(openLogDir).mockReset();
	vi.mocked(autostartEnabled).mockResolvedValue(false);
	vi.mocked(setAutostart).mockReset();
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

describe("AppSettings: iniciar com o Windows", () => {
	it("começa como o Windows diz, e ligar pede ao Rust", async () => {
		vi.mocked(setAutostart).mockResolvedValue();
		const user = userEvent.setup();
		render(<AppSettings />);
		const toggle = await screen.findByRole("switch", {
			name: "Iniciar com o Windows",
		});
		await vi.waitFor(() => expect(toggle).not.toHaveAttribute("data-disabled"));
		expect(toggle).not.toBeChecked();

		await user.click(toggle);
		expect(setAutostart).toHaveBeenCalledWith(true);
		expect(toggle).toBeChecked();
	});

	it("se o Windows recusar, a chave volta e diz o porquê", async () => {
		vi.mocked(autostartEnabled).mockResolvedValue(true);
		vi.mocked(setAutostart).mockRejectedValue({ kind: "Internal", message: "x" });
		const user = userEvent.setup();
		render(<AppSettings />);
		const toggle = screen.getByRole("switch", { name: "Iniciar com o Windows" });
		await vi.waitFor(() => expect(toggle).toBeChecked());

		await user.click(toggle);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Não deu para mudar a inicialização do Windows.",
		);
		expect(toggle).toBeChecked();
	});
});

describe("AppSettings: aceleração de hardware", () => {
	it("desligar pede ao Rust e oferece reiniciar", async () => {
		render(<AppSettings />);
		const toggle = screen.getByRole("switch", {
			name: "Aceleração de hardware",
		});
		await vi.waitFor(() => expect(toggle).toBeEnabled());
		expect(toggle).toBeChecked();
		await userEvent.click(toggle);
		expect(setHardwareAcceleration).toHaveBeenCalledWith(false);
		await userEvent.click(
			screen.getByRole("button", { name: "Reiniciar agora" }),
		);
		expect(restartApp).toHaveBeenCalled();
		expect(hardwareAcceleration).toHaveBeenCalled();
	});
});

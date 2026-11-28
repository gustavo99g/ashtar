import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identityKeys } from "@/features/identity";
import {
	createStreamPairCode,
	listStreamDevices,
	type MeResponse,
	renameStreamDevice,
	type StreamDevice,
	unlinkStreamDevice,
} from "@/lib/api";
import {
	isLocalAddress,
	remaining,
	spacedCode,
	StreamDevicesSettings,
} from "../components/StreamDevicesSettings";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listStreamDevices: vi.fn(),
	createStreamPairCode: vi.fn(),
	renameStreamDevice: vi.fn(),
	unlinkStreamDevice: vi.fn(),
}));

const odin: StreamDevice = {
	id: "abc",
	name: "Odin 3",
	paired_at: 1_764_000_000,
	last_seen_at: 1_764_000_000,
};

function me(allowed: boolean): MeResponse {
	return {
		user: { id: "u1", nick: "kid", display_name: null, is_owner: true },
		permissions: [],
		update_channel: "stable",
		status: "available",
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: true,
		can_move_members: true,
		can_manage_emojis: true,
		can_view_logs: true,
		can_moderate_voice: true,
		can_send_sounds: true,
		can_approve_sounds: true,
		can_stream_from_device: allowed,
	};
}

function renderPage(allowed = true) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	client.setQueryData(identityKeys.me(), me(allowed));
	return render(
		<QueryClientProvider client={client}>
			<StreamDevicesSettings />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(listStreamDevices).mockResolvedValue([]);
	vi.mocked(createStreamPairCode).mockResolvedValue({
		code: "042917",
		expires_at: Math.floor(Date.now() / 1000) + 180,
	});
	vi.mocked(renameStreamDevice).mockResolvedValue({ ...odin, name: "Odin" });
	vi.mocked(unlinkStreamDevice).mockResolvedValue();
});

describe("Configurações › Dispositivos", () => {
	it("o tempo que falta para o código vencer", () => {
		expect(remaining(1000, 1000 * 1000 - 600_000)).toBe("10:00");
		expect(remaining(1000, 1000 * 1000 - 61_000)).toBe("1:01");
		expect(remaining(1000, 2000 * 1000)).toBe("0:00");
	});

	it("o código aparece em dois grupos de 3", () => {
		expect(spacedCode("042917")).toBe("042 917");
		expect(spacedCode("ABC")).toBe("ABC");
	});

	it("o endereço local avisa que o aparelho precisa do IP da rede", () => {
		expect(isLocalAddress("http://127.0.0.1:3000")).toBe(true);
		expect(isLocalAddress("http://localhost:3000")).toBe(true);
		expect(isLocalAddress("https://casa.tail.ts.net")).toBe(false);
	});

	it("sem aparelhos, mostra o vazio; parear mostra os passos, o endereço e o código", async () => {
		const user = userEvent.setup();
		renderPage();
		expect(await screen.findByText("Nenhum aparelho pareado")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Parear um aparelho" }));
		const card = await screen.findByRole("region", { name: "Parear um aparelho" });
		expect(within(card).getByText("042 917")).toBeVisible();
		expect(within(card).getByText(/Vale por (3:00|2:59)/)).toBeVisible();
		expect(within(card).getByText("Digite o endereço do servidor")).toBeVisible();
		expect(within(card).getByRole("progressbar", { name: "Tempo do código" })).toBeVisible();
		// Com um código na tela, não gera outro.
		expect(screen.getByRole("button", { name: "Parear um aparelho" })).toBeDisabled();
		await user.click(within(card).getByRole("button", { name: "Cancelar" }));
		expect(screen.queryByRole("region", { name: "Parear um aparelho" })).toBeNull();
	});

	it("renomeia na própria linha", async () => {
		const user = userEvent.setup();
		vi.mocked(listStreamDevices).mockResolvedValue([odin]);
		renderPage();
		await user.click(await screen.findByRole("button", { name: "Renomear Odin 3" }));
		const input = screen.getByRole("textbox", { name: "Nome do aparelho" });
		await user.clear(input);
		await user.type(input, "Odin{Enter}");
		expect(renameStreamDevice).toHaveBeenCalledWith("abc", "Odin");
	});

	it("desvincular pede confirmação", async () => {
		const user = userEvent.setup();
		vi.mocked(listStreamDevices).mockResolvedValue([odin]);
		renderPage();
		await user.click(await screen.findByRole("button", { name: "Desvincular Odin 3" }));
		expect(unlinkStreamDevice).not.toHaveBeenCalled();
		expect(screen.getByText("Desvincular? A transmissão dele cai.")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Desvincular" }));
		expect(unlinkStreamDevice).toHaveBeenCalledWith("abc");
	});

	it("com 3 aparelhos, não pareia outro", async () => {
		vi.mocked(listStreamDevices).mockResolvedValue([
			odin,
			{ ...odin, id: "b", name: "Odin 2" },
			{ ...odin, id: "c", name: "Retroid" },
		]);
		renderPage();
		expect(await screen.findByText("Retroid")).toBeVisible();
		expect(screen.getByRole("button", { name: "Parear um aparelho" })).toBeDisabled();
	});

	it("sem a permissão, explica em vez de mostrar a lista", () => {
		renderPage(false);
		expect(screen.getByText("Sem a permissão para transmitir de um aparelho")).toBeVisible();
		expect(listStreamDevices).not.toHaveBeenCalled();
	});
});

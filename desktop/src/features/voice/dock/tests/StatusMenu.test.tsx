import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identityKeys, useSessionStore } from "@/features/identity";
import { type MeResponse, setStatus } from "@/lib/api";
import { paths } from "@/lib/paths";
import { useVoice } from "../../room/hooks/useVoice";
import { UserPanel } from "../components/UserPanel";

vi.mock("../../room/hooks/useVoice", () => ({ useVoice: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	setStatus: vi.fn(),
}));

const kid = { id: "kid", nick: "kid", display_name: null, is_owner: true };

function me(status: MeResponse["status"]): MeResponse {
	return {
		user: kid,
		permissions: [],
		update_channel: "stable",
		status,
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: true,
		can_move_members: true, can_manage_emojis: false, can_view_logs: false, can_moderate_voice: false, can_send_sounds: false, can_approve_sounds: false, can_stream_from_device: false,
	};
}

function renderPanel(status: MeResponse["status"] = "available") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	client.setQueryData(identityKeys.me(), me(status));
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={["/"]}>
				<Routes>
					<Route path="/" element={<UserPanel />} />
					<Route path={paths.settings.profile} element={<p>Perfil</p>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	vi.mocked(useVoice).mockReturnValue({
		isMuted: false,
		isDeafened: false,
		mute: vi.fn(),
		unmute: vi.fn(),
		deafen: vi.fn(),
		undeafen: vi.fn(),
	} as never);
	vi.mocked(setStatus).mockReset();
});

describe("o menu de status", () => {
	it("o painel mostra o status, e o avatar e o nome abrem o menu com os quatro", async () => {
		const user = userEvent.setup();
		renderPanel();
		const trigger = screen.getByRole("button", { name: "Seu status" });
		expect(within(trigger).getByText("Disponível")).toBeInTheDocument();

		await user.click(trigger);
		const menu = await screen.findByRole("menu", { name: "Seu status" });
		expect(within(menu).getByText("Dono do Ashtar")).toBeInTheDocument();
		const options = within(menu).getAllByRole("menuitemradio");
		expect(options.map((o) => o.textContent)).toEqual([
			expect.stringContaining("DisponívelTudo normal."),
			expect.stringContaining("AusenteOs outros veem que você saiu."),
			expect.stringContaining("OcupadoSem notificações nem toque de ligação."),
			expect.stringContaining("InvisívelVocê aparece offline"),
		]);
		expect(options[0]).toHaveAttribute("aria-checked", "true");
	});

	it("escolher Ocupado vale na hora: o texto fica vermelho e a bolinha muda", async () => {
		vi.mocked(setStatus).mockResolvedValue(me("busy"));
		const user = userEvent.setup();
		renderPanel();
		await user.click(screen.getByRole("button", { name: "Seu status" }));
		await user.click(await screen.findByRole("menuitemradio", { name: /^Ocupado/ }));

		expect(setStatus).toHaveBeenCalledWith("busy");
		const trigger = screen.getByRole("button", { name: "Seu status" });
		const label = within(trigger).getByText("Ocupado");
		expect(label).toHaveClass("text-destructive-text");
		expect(label).toHaveAttribute("title", "Notificações e toque de ligação desligados");
		expect(trigger.querySelector("[data-status]")).toHaveAttribute(
			"data-status",
			"busy",
		);
	});

	it("Editar perfil leva às configurações do perfil", async () => {
		const user = userEvent.setup();
		renderPanel("invisible");
		expect(screen.getByText("Invisível")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Seu status" }));
		await user.click(await screen.findByRole("menuitem", { name: "Editar perfil" }));
		expect(await screen.findByText("Perfil")).toBeInTheDocument();
	});
});

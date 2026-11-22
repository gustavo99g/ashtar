import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelDialog } from "@/features/channels";
import { identityKeys } from "@/features/identity";
import { useUnreadStore } from "@/features/unread";
import { markAllRead, type MeResponse } from "@/lib/api";
import { paths } from "@/lib/paths";
import { ServerMenu } from "../components/ServerMenu";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	markAllRead: vi.fn(),
}));

function renderMenu({ owner = false, manage = false } = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	const me: MeResponse = {
		user: { id: "kid", nick: "kid", display_name: null, is_owner: owner },
		permissions: [],
		update_channel: "stable",
		status: "available",
		can_create_invite: owner,
		can_view_panel: owner,
		can_manage_channels: manage,
		can_move_members: manage, can_manage_emojis: false, can_view_logs: false,
	};
	client.setQueryData(identityKeys.me(), me);
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[paths.channel("geral")]}>
				<Routes>
					<Route path={paths.channelPattern} element={<ServerMenu />} />
					<Route path={paths.settings.invites} element={<p>Convites</p>} />
					<Route path={paths.settings.archived} element={<p>Arquivados</p>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

async function openMenu() {
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Menu do Ashtar" }));
	await screen.findByRole("menu", { name: "Menu do Ashtar" });
	return user;
}

function items() {
	return screen.getAllByRole("menuitem").map((item) => item.textContent);
}

const unread = (count: number) => ({
	last_read_id: "m1",
	unread: count,
	mentions: 0,
	muted: false,
});

beforeEach(() => {
	useChannelDialog.setState({ dialog: null });
	useUnreadStore.setState({ me: "kid", byChannel: {}, newest: {} });
	vi.mocked(markAllRead).mockResolvedValue();
});

describe("o menu do servidor", () => {
	it("quem não convida nem gerencia tem só o Marcar tudo como lido, apagado sem não lidas", async () => {
		renderMenu();
		await openMenu();

		expect(items()).toEqual(["Marcar tudo como lido"]);
		expect(
			screen.getByRole("menuitem", { name: "Marcar tudo como lido" }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("Marcar tudo como lido zera tudo aqui e pede à API", async () => {
		useUnreadStore.setState({
			byChannel: { geral: unread(3), "d-ana": unread(1) },
			newest: { geral: "m9", "d-ana": "m7" },
		});
		renderMenu();
		const user = await openMenu();

		await user.click(screen.getByRole("menuitem", { name: "Marcar tudo como lido" }));

		expect(markAllRead).toHaveBeenCalledTimes(1);
		const { byChannel } = useUnreadStore.getState();
		expect(byChannel.geral).toEqual({ ...unread(0), last_read_id: "m9" });
		expect(byChannel["d-ana"]).toEqual({ ...unread(0), last_read_id: "m7" });
	});

	it("o dono que gerencia vê tudo", async () => {
		renderMenu({ owner: true, manage: true });
		await openMenu();

		expect(items()).toEqual([
			"Marcar tudo como lido",
			"Convidar pessoas",
			"Criar canal",
			"Criar categoria",
			"Organizar canais",
			"Canais arquivados",
		]);
	});

	it("quem só gerencia os canais não vê o Convidar", async () => {
		renderMenu({ manage: true });
		await openMenu();

		expect(items()).toEqual([
			"Marcar tudo como lido",
			"Criar canal",
			"Criar categoria",
			"Organizar canais",
			"Canais arquivados",
		]);
	});

	it("o dono sem Gerenciar canais vê só o Convidar, que leva aos Convites", async () => {
		renderMenu({ owner: true });
		const user = await openMenu();

		expect(items()).toEqual(["Marcar tudo como lido", "Convidar pessoas"]);
		await user.click(screen.getByRole("menuitem", { name: "Convidar pessoas" }));
		expect(await screen.findByText("Convites")).toBeInTheDocument();
	});

	it("Criar canal abre o diálogo no topo da lista, e Criar categoria o dela", async () => {
		renderMenu({ manage: true });
		let user = await openMenu();
		await user.click(screen.getByRole("menuitem", { name: "Criar canal" }));
		expect(useChannelDialog.getState().dialog).toEqual({
			kind: "createChannel",
			categoryId: null,
		});

		user = await openMenu();
		await user.click(screen.getByRole("menuitem", { name: "Criar categoria" }));
		expect(useChannelDialog.getState().dialog).toEqual({
			kind: "createCategory",
		});
	});

	it("Canais arquivados leva a Configurações › Arquivados", async () => {
		renderMenu({ manage: true });
		const user = await openMenu();

		await user.click(screen.getByRole("menuitem", { name: "Canais arquivados" }));

		expect(await screen.findByText("Arquivados")).toBeInTheDocument();
	});
});

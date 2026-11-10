import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useChannelDialog } from "@/features/channels";
import { identityKeys } from "@/features/identity";
import type { MeResponse } from "@/lib/api";
import { paths } from "@/lib/paths";
import { ServerMenu } from "../components/ServerMenu";

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

beforeEach(() => {
	useChannelDialog.setState({ dialog: null });
});

describe("o menu do servidor", () => {
	it("quem não convida nem gerencia vê só o nome, sem menu", () => {
		renderMenu();

		expect(screen.getByText("Ashtar")).toBeInTheDocument();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("o dono que gerencia vê tudo", async () => {
		renderMenu({ owner: true, manage: true });
		await openMenu();

		expect(items()).toEqual([
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
			"Criar canal",
			"Criar categoria",
			"Organizar canais",
			"Canais arquivados",
		]);
	});

	it("o dono sem Gerenciar canais vê só o Convidar, que leva aos Convites", async () => {
		renderMenu({ owner: true });
		const user = await openMenu();

		expect(items()).toEqual(["Convidar pessoas"]);
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

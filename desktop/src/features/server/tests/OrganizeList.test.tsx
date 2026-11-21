import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import {
	dragId,
	dropInDraft,
	startOrganizing,
	stopOrganizing,
	useOrganize,
} from "@/features/channels";
import { identityKeys, useSessionStore } from "@/features/identity";
import { VoiceProvider } from "@/features/voice";
import {
	ApiError,
	type ChannelView,
	getChannelLayout,
	type Layout,
	type MeResponse,
	setChannelLayout,
} from "@/lib/api";
import { paths } from "@/lib/paths";
import { ChannelNav } from "../components/ChannelNav";
import { ServerMenu } from "../components/ServerMenu";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listVoiceParticipants: vi.fn(async () => []),
	setChannelLayout: vi.fn(),
	getChannelLayout: vi.fn(),
}));

const kid = { id: "kid", nick: "kid", display_name: null, is_owner: true };

function channel(
	id: string,
	category_id: string | null = null,
	kind: ChannelView["kind"] = "text",
): ChannelView {
	return { id, kind, name: id, topic: null, category_id, archived_at: null, restricted: false };
}

/** Topo: geral, Sala. Jogos: lol, cs. Vazia: nada. */
const layout: Layout = {
	version: 3,
	top: [channel("geral"), { ...channel("sala", null, "voice"), name: "Sala" }],
	categories: [
		{
			id: "jogos",
			name: "Jogos",
			channels: [channel("lol", "jogos"), channel("cs", "jogos")],
		},
		{ id: "vazia", name: "Vazia", channels: [] },
	],
};

function renderColumn() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	const me: MeResponse = {
		user: kid,
		permissions: [],
		update_channel: "stable",
		status: "available",
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: true,
		can_move_members: true, can_manage_emojis: false,
	};
	client.setQueryData(identityKeys.me(), me);
	client.setQueryData(["channels", "layout"], layout);
	const column = (
		<>
			<ServerMenu />
			<ChannelNav />
		</>
	);
	render(
		<QueryClientProvider client={client}>
			<VoiceProvider>
				<MemoryRouter initialEntries={[paths.channel("geral")]}>
					<Routes>
						<Route path={paths.channelPattern} element={column} />
					</Routes>
				</MemoryRouter>
			</VoiceProvider>
		</QueryClientProvider>,
	);
	return client;
}

/** A ordem que a tela mostra no modo: o topo e depois cada categoria com os canais dela. */
function shownOrder() {
	const nav = screen.getByRole("navigation", { name: "Canais" });
	return within(nav)
		.getAllByRole("button", { name: /^Mover / })
		.map((handle) => handle.getAttribute("aria-label"));
}

beforeEach(() => {
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	stopOrganizing();
	vi.spyOn(toast, "add");
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("o modo Organizar", () => {
	it("fora do modo, nenhuma linha tem alça", () => {
		renderColumn();

		expect(screen.queryByRole("button", { name: /^Mover / })).toBeNull();
		expect(screen.queryByText("Organizando canais.")).toBeNull();
	});

	it("entra pelo menu do servidor, e o menu fica desligado enquanto durar", async () => {
		const user = userEvent.setup();
		renderColumn();

		await user.click(screen.getByRole("button", { name: "Menu do Ashtar" }));
		await user.click(
			await screen.findByRole("menuitem", { name: "Organizar canais" }),
		);

		expect(await screen.findByText("Organizando canais.")).toBeVisible();
		expect(useOrganize.getState().draft).toEqual(layout);
		expect(screen.getByRole("button", { name: "Menu do Ashtar" })).toBeDisabled();
	});

	it("toda linha vira uma caixa com a alça, sem navegar e sem menu", () => {
		renderColumn();
		act(() => startOrganizing(layout));

		expect(shownOrder()).toEqual([
			"Mover #geral",
			"Mover Sala",
			"Mover a categoria Jogos",
			"Mover #lol",
			"Mover #cs",
			"Mover a categoria Vazia",
		]);
		// Os canais não são botões aqui, e as ferramentas da lista somem.
		expect(screen.queryByRole("button", { name: "geral" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Entrar na Sala" })).toBeNull();
		expect(screen.queryByRole("button", { name: /^Ações para/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /^Criar canal em/ })).toBeNull();
	});

	it("cada soltura muda a tela e não manda nada para a API", () => {
		renderColumn();
		act(() => startOrganizing(layout));

		act(() => dropInDraft(dragId.channel("cs"), dragId.channel("lol")));
		act(() => dropInDraft(dragId.channel("geral"), dragId.category("vazia")));
		act(() => dropInDraft(dragId.category("vazia"), dragId.category("jogos")));

		expect(shownOrder()).toEqual([
			"Mover Sala",
			"Mover a categoria Vazia",
			"Mover #geral",
			"Mover a categoria Jogos",
			"Mover #cs",
			"Mover #lol",
		]);
		expect(setChannelLayout).not.toHaveBeenCalled();
	});

	it("o Concluir grava tudo num pedido só, com a versão de quando o modo abriu", async () => {
		const user = userEvent.setup();
		const saved: Layout = { ...layout, version: 4 };
		vi.mocked(setChannelLayout).mockResolvedValue(saved);
		const client = renderColumn();
		act(() => startOrganizing(layout));
		act(() => dropInDraft(dragId.channel("cs"), dragId.channel("lol")));
		act(() => dropInDraft(dragId.channel("geral"), dragId.category("vazia")));

		await user.click(screen.getByRole("button", { name: "Concluir" }));

		await waitFor(() => expect(useOrganize.getState().draft).toBeNull());
		expect(setChannelLayout).toHaveBeenCalledTimes(1);
		expect(setChannelLayout).toHaveBeenCalledWith({
			version: 3,
			top: ["sala"],
			categories: [
				{ id: "jogos", channels: ["cs", "lol"] },
				{ id: "vazia", channels: ["geral"] },
			],
		});
		expect(client.getQueryData(["channels", "layout"])).toEqual(saved);
		expect(screen.queryByText("Organizando canais.")).toBeNull();
	});

	it("o Concluir sem mudança só sai do modo", async () => {
		const user = userEvent.setup();
		renderColumn();
		act(() => startOrganizing(layout));

		await user.click(screen.getByRole("button", { name: "Concluir" }));

		expect(useOrganize.getState().draft).toBeNull();
		expect(setChannelLayout).not.toHaveBeenCalled();
	});

	it("o Desfazer joga a cópia fora, e a lista volta como era", async () => {
		const user = userEvent.setup();
		renderColumn();
		act(() => startOrganizing(layout));
		act(() => dropInDraft(dragId.channel("cs"), dragId.channel("lol")));

		await user.click(screen.getByRole("button", { name: "Desfazer" }));

		expect(setChannelLayout).not.toHaveBeenCalled();
		const jogos = screen.getByRole("region", { name: "Jogos" });
		expect(
			within(jogos)
				.getAllByRole("button", { name: /^(lol|cs)$/ })
				.map((button) => button.textContent),
		).toEqual(["lol", "cs"]);
	});

	it("num 409, busca a árvore nova, continua no modo a partir dela e avisa", async () => {
		const user = userEvent.setup();
		const fresh: Layout = {
			...layout,
			version: 9,
			top: [channel("geral"), channel("novo")],
		};
		vi.mocked(setChannelLayout).mockRejectedValue(
			new ApiError({ status: 409, kind: "conflict", message: "conflito" }),
		);
		vi.mocked(getChannelLayout).mockResolvedValue(fresh);
		renderColumn();
		act(() => startOrganizing(layout));
		act(() => dropInDraft(dragId.channel("cs"), dragId.channel("lol")));

		await user.click(screen.getByRole("button", { name: "Concluir" }));

		await waitFor(() =>
			expect(useOrganize.getState()).toMatchObject({ base: fresh, draft: fresh }),
		);
		expect(screen.getByText("Organizando canais.")).toBeVisible();
		expect(screen.getByRole("button", { name: "Mover #novo" })).toBeVisible();
		expect(toast.add).toHaveBeenCalledWith({
			title: "Outra pessoa mudou os canais",
			description: "Confira a ordem e conclua de novo.",
		});
	});

	it("em outro erro, o modo fica como está, com a ordem que a pessoa arrumou", async () => {
		const user = userEvent.setup();
		vi.mocked(setChannelLayout).mockRejectedValue(
			new ApiError({ status: 0, kind: "network", message: "sem rede" }),
		);
		renderColumn();
		act(() => startOrganizing(layout));
		act(() => dropInDraft(dragId.channel("cs"), dragId.channel("lol")));

		await user.click(screen.getByRole("button", { name: "Concluir" }));

		await waitFor(() =>
			expect(toast.add).toHaveBeenCalledWith({
				title: "Não deu para gravar a ordem",
				description: "sem rede",
			}),
		);
		expect(getChannelLayout).not.toHaveBeenCalled();
		expect(shownOrder().slice(3, 5)).toEqual(["Mover #cs", "Mover #lol"]);
	});
});

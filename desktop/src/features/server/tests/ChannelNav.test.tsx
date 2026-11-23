import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelDialog, useCollapsed } from "@/features/channels";
import { identityKeys, useSessionStore } from "@/features/identity";
import { clearUnread, useUnreadStore } from "@/features/unread";
import { VoiceProvider } from "@/features/voice";
import {
	type ChannelView,
	type Layout,
	listVoiceParticipants,
	type MeResponse,
	markRead,
	type ParticipantView,
	setChannelLayout,
	setMuted,
} from "@/lib/api";
import { paths } from "@/lib/paths";
import { ChannelNav } from "../components/ChannelNav";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listVoiceParticipants: vi.fn(),
	markRead: vi.fn(),
	setChannelLayout: vi.fn(),
	setMuted: vi.fn(),
	getChannelLayout: vi.fn(() => new Promise(() => {})),
}));

const kid = { id: "kid", nick: "kid", display_name: null, is_owner: true };

function channel(
	id: string,
	category_id: string | null = null,
	kind: ChannelView["kind"] = "text",
): ChannelView {
	return { id, kind, name: id, topic: null, category_id, archived_at: null, restricted: false };
}

const layout: Layout = {
	version: 3,
	top: [channel("geral"), { ...channel("sala", null, "voice"), name: "Sala" }],
	categories: [
		{
			id: "jogos",
			name: "Jogos",
			channels: [
				channel("lol", "jogos"),
				channel("cs", "jogos"),
				{ ...channel("squad", "jogos", "voice"), name: "Squad" },
				{ ...channel("vazia", "jogos", "voice"), name: "Vazia" },
			],
		},
	],
};

function person(id: string, sharing = false): ParticipantView {
	return { user_id: id, nick: id, display_name: null, screen_sharing: sharing, mic_off: false, deafened: false, camera: false, server_muted: false, server_deafened: false };
}

function renderNav({ manage = false, at = paths.channel("geral") } = {}) {
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
		can_manage_channels: manage,
		can_move_members: manage, can_manage_emojis: false, can_view_logs: false, can_moderate_voice: false,
	};
	client.setQueryData(identityKeys.me(), me);
	client.setQueryData(["channels", "layout"], layout);
	render(
		<QueryClientProvider client={client}>
			<VoiceProvider>
				<MemoryRouter initialEntries={[at]}>
					<ChannelNav />
				</MemoryRouter>
			</VoiceProvider>
		</QueryClientProvider>,
	);
}

/**
 * No jsdom, o submenu do Base UI fica com `pointer-events: none` enquanto "abre" (não há layout
 * para ele medir). O clique é o mesmo; só a conferência do user-event é que sai.
 */
function submenuUser() {
	return userEvent.setup({ pointerEventsCheck: 0 });
}

beforeEach(() => {
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	useCollapsed.setState({ collapsed: {} });
	useChannelDialog.setState({ dialog: null });
	clearUnread();
	vi.mocked(listVoiceParticipants).mockImplementation(async (id) =>
		id === "squad"
			? ["ana", "bia", "caio", "duda", "edu", "fabi", "gabi"].map((nick, i) =>
					person(nick, i === 0),
				)
			: [],
	);
});

afterEach(() => {
	vi.clearAllMocks();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("a coluna de canais", () => {
	it("mostra o topo e as categorias, com o canal aberto marcado", async () => {
		renderNav({ at: paths.channel("cs") });

		const jogos = screen.getByRole("region", { name: "Jogos" });
		expect(
			within(jogos).getByRole("button", { name: "lol" }),
		).toBeInTheDocument();
		expect(within(jogos).getByRole("button", { name: "cs" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(
			screen.getByRole("button", { name: "Entrar na Sala" }),
		).toBeInTheDocument();
		expect(
			await screen.findByRole("list", { name: "Quem está na Squad" }),
		).toBeInTheDocument();
	});

	it("recolhida, a categoria guarda o canal aberto e as salas com gente, só com os avatares", async () => {
		const user = userEvent.setup();
		renderNav({ at: paths.channel("cs") });
		await screen.findByRole("list", { name: "Quem está na Squad" });

		const toggle = screen.getByRole("button", {
			name: "Jogos",
			expanded: true,
		});
		await user.click(toggle);

		const jogos = screen.getByRole("region", { name: "Jogos" });
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(within(jogos).queryByRole("button", { name: "lol" })).toBeNull();
		expect(
			within(jogos).getByRole("button", { name: "cs" }),
		).toBeInTheDocument();
		expect(within(jogos).queryByRole("button", { name: /Vazia/ })).toBeNull();
		// A Squad fica, sem a lista de nomes: 5 avatares, "+2" e o selo de quem transmite.
		expect(
			screen.queryByRole("list", { name: "Quem está na Squad" }),
		).toBeNull();
		const squad = within(jogos).getByRole("button", {
			name: "Entrar na Squad",
		});
		expect(within(squad).getByText("+2")).toBeInTheDocument();
		// Fica neste computador.
		expect(useCollapsed.getState().collapsed).toEqual({ jogos: true });
	});

	it("as não lidas: o canal em destaque, o ponto na categoria recolhida e o Marcar como lido", async () => {
		const fresh = { last_read_id: "m1", unread: 2, mentions: 0, muted: false };
		useUnreadStore.setState({
			me: "kid",
			byChannel: { geral: fresh, lol: fresh },
			newest: { geral: "m3", lol: "m3" },
		});
		vi.mocked(markRead).mockResolvedValue({ ...fresh, last_read_id: "m3", unread: 0 });
		const user = userEvent.setup();
		renderNav();

		// O canal aberto não chama atenção: as novas são lidas ali mesmo.
		expect(screen.getByRole("button", { name: "geral" })).toBeInTheDocument();
		const lol = screen.getByRole("button", { name: /^lol,? com mensagens novas$/ });

		// Recolhida, a categoria avisa que esconde um canal com não lidas.
		await user.click(screen.getByRole("button", { name: "Jogos", expanded: true }));
		expect(
			screen.getByRole("button", { name: /^Jogos,? com mensagens novas$/ }),
		).toBeInTheDocument();
		expect(lol).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /^Jogos/ }));

		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: /^lol/ }),
		});
		await user.click(await screen.findByRole("menuitem", { name: "Marcar como lido" }));
		expect(markRead).toHaveBeenCalledWith("lol", { message_id: "m3" });
		expect(screen.getByRole("button", { name: "lol" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Jogos", expanded: true })).toBeInTheDocument();
	});

	it("silenciado: apagado e sem destaque, mas o número das menções aparece", async () => {
		const state = { last_read_id: "m1", unread: 4, mentions: 0, muted: false };
		useUnreadStore.setState({
			me: "kid",
			byChannel: { lol: state, cs: { ...state, mentions: 2 } },
			newest: { lol: "m5", cs: "m5" },
		});
		vi.mocked(setMuted).mockResolvedValue({ ...state, muted: true });
		const user = userEvent.setup();
		renderNav();

		expect(
			within(screen.getByRole("button", { name: /^cs/ })).getByLabelText("2 menções"),
		).toBeInTheDocument();

		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: /^lol/ }),
		});
		await user.click(await screen.findByRole("menuitem", { name: "Silenciar canal" }));
		expect(setMuted).toHaveBeenCalledWith("lol", { muted: true });
		expect(
			screen.getByRole("button", { name: /^lol,? silenciado$/ }),
		).toBeInTheDocument();

		// Silenciado com menção: o número aparece mesmo assim.
		act(() =>
			useUnreadStore.setState((s) => ({
				byChannel: { ...s.byChannel, lol: { ...state, muted: true, mentions: 1 } },
			})),
		);
		expect(
			within(screen.getByRole("button", { name: /^lol/ })).getByLabelText("1 menção"),
		).toBeInTheDocument();

		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: /^lol/ }),
		});
		expect(
			await screen.findByRole("menuitem", { name: "Voltar a ouvir" }),
		).toBeInTheDocument();
	});

	it("clicar em alguém da sala abre o cartão da pessoa", async () => {
		const user = userEvent.setup();
		renderNav();
		const squad = await screen.findByRole("list", {
			name: "Quem está na Squad",
		});

		await user.click(within(squad).getByRole("button", { name: /ana/ }));

		const card = await screen.findByRole("dialog", { name: "Perfil de ana" });
		expect(within(card).getByText("Em Squad · transmitindo")).toBeVisible();
	});

	it("sem Gerenciar canais, o canal de texto só tem o Marcar como lido e o Silenciar, e a sala nada", async () => {
		const user = userEvent.setup();
		renderNav();

		expect(screen.queryByRole("button", { name: /^Criar canal/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "Ações para Squad" })).toBeNull();
		// O botão direito na sala também não abre nada.
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: "Entrar na Squad" }),
		});
		expect(screen.queryByRole("menu")).toBeNull();

		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: "lol" }),
		});
		const menu = await screen.findByRole("menu", { name: "Ações para #lol" });
		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((item) => item.textContent),
		).toEqual(["Marcar como lido", "Silenciar canal"]);
	});

	it("a lista não tem alça de arrastar nem Mover para cima e para baixo", async () => {
		const user = userEvent.setup();
		renderNav({ manage: true });

		expect(screen.queryByRole("button", { name: /^Mover/ })).toBeNull();
		await user.click(screen.getByRole("button", { name: "Ações para #lol" }));
		await screen.findByRole("menuitem", { name: "Editar canal" });
		expect(
			screen.queryByRole("menuitem", { name: "Mover para cima" }),
		).toBeNull();
	});

	it("o Mover para leva o canal para o fim da categoria, com a versão vista", async () => {
		vi.mocked(setChannelLayout).mockImplementation(async (request) => ({
			...layout,
			version: request.version + 1,
		}));
		const user = submenuUser();
		renderNav({ manage: true });

		await user.click(screen.getByRole("button", { name: "Ações para #geral" }));
		await user.click(await screen.findByRole("menuitem", { name: "Mover para" }));
		const targets = await screen.findByRole("menu", { name: "Mover para" });
		// O lugar em que o canal está vem marcado.
		expect(
			within(targets).getByRole("menuitem", { name: "Sem categoria" }),
		).toHaveAttribute("aria-current", "true");
		fireEvent.click(within(targets).getByRole("menuitem", { name: "Jogos" }));

		await waitFor(() => expect(setChannelLayout).toHaveBeenCalled());
		expect(setChannelLayout).toHaveBeenCalledWith({
			version: 3,
			top: ["sala"],
			categories: [
				{ id: "jogos", channels: ["lol", "cs", "squad", "vazia", "geral"] },
			],
		});
	});

	it("escolher o lugar em que o canal já está não grava nada", async () => {
		const user = submenuUser();
		renderNav({ manage: true });

		await user.click(screen.getByRole("button", { name: "Ações para #lol" }));
		await user.click(await screen.findByRole("menuitem", { name: "Mover para" }));
		const targets = await screen.findByRole("menu", { name: "Mover para" });
		fireEvent.click(within(targets).getByRole("menuitem", { name: "Jogos" }));

		expect(setChannelLayout).not.toHaveBeenCalled();
	});

	it("com uma ordem ainda sendo gravada, não manda outra com a versão velha", async () => {
		// A primeira gravação nunca responde: a segunda sairia com a versão antiga e levaria 409.
		vi.mocked(setChannelLayout).mockReturnValue(new Promise(() => {}));
		const user = submenuUser();
		renderNav({ manage: true });

		async function moveTo(channel: string, target: string) {
			await user.click(
				screen.getByRole("button", { name: `Ações para #${channel}` }),
			);
			await user.click(
				await screen.findByRole("menuitem", { name: "Mover para" }),
			);
			const targets = await screen.findByRole("menu", { name: "Mover para" });
			fireEvent.click(within(targets).getByRole("menuitem", { name: target }));
		}

		await moveTo("geral", "Jogos");
		await waitFor(() => expect(setChannelLayout).toHaveBeenCalledTimes(1));
		await moveTo("lol", "Sem categoria");
		// Dá tempo de um segundo pedido sair, se fosse sair.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(setChannelLayout).toHaveBeenCalledTimes(1);
	});

	it("o botão direito na linha abre o mesmo menu da engrenagem", async () => {
		const user = userEvent.setup();
		renderNav({ manage: true });

		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: "cs" }),
		});

		expect(
			await screen.findByRole("menu", { name: "Ações para #cs" }),
		).toBeInTheDocument();
	});

	it("o #geral e a Sala não têm Arquivar; os outros canais abrem a confirmação", async () => {
		const user = userEvent.setup();
		renderNav({ manage: true });

		await user.click(screen.getByRole("button", { name: "Ações para #geral" }));
		expect(
			await screen.findByRole("menuitem", { name: "Editar canal" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("menuitem", { name: "Arquivar canal" }),
		).toBeNull();
		await user.keyboard("{Escape}");

		await user.click(screen.getByRole("button", { name: "Ações para #lol" }));
		await user.click(
			await screen.findByRole("menuitem", { name: "Arquivar canal" }),
		);
		expect(useChannelDialog.getState().dialog).toMatchObject({
			kind: "archiveChannel",
			channel: { id: "lol" },
		});
	});

	it("o botão direito no nome da categoria abre Renomear e Arquivar", async () => {
		const user = userEvent.setup();
		renderNav({ manage: true });

		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: "Jogos", expanded: true }),
		});
		await user.click(
			await screen.findByRole("menuitem", { name: "Renomear categoria" }),
		);

		expect(useChannelDialog.getState().dialog).toMatchObject({
			kind: "renameCategory",
			category: { id: "jogos" },
		});
	});

	it("o + da categoria abre o Criar canal já nela", async () => {
		const user = userEvent.setup();
		renderNav({ manage: true });

		await user.click(
			screen.getByRole("button", { name: "Criar canal em Jogos" }),
		);

		expect(useChannelDialog.getState().dialog).toEqual({
			kind: "createChannel",
			categoryId: "jogos",
		});
	});
});

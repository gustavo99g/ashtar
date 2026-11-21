import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { clearUnread, useUnreadStore } from "@/features/unread";
import {
	type Conversation,
	listDms,
	listMessages,
	listPeople,
	type Message,
	openDm,
	type Person,
	sendMessage,
	setMuted,
} from "@/lib/api";
import { paths } from "@/lib/paths";
import { DmDock } from "../components/DmDock";
import { DmList } from "../components/DmList";
import { clearOpenDms, showDm, useOpenDms } from "../stores/openDmsStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listDms: vi.fn(),
	listMessages: vi.fn(),
	listPeople: vi.fn(),
	openDm: vi.fn(),
	sendMessage: vi.fn(),
	setMuted: vi.fn(),
}));
vi.mock("@/lib/tauri/opener", () => ({ openLink: vi.fn() }));

const kid = { id: "kid", nick: "kid", display_name: null, is_owner: true };

function person(id: string, online = true): Person {
	return {
		id,
		nick: id,
		display_name: null,
		is_owner: false,
		online,
		status: "available",
	};
}

function message(id: string, channelId: string, authorId: string, body: string): Message {
	return {
		id,
		channel_id: channelId,
		client_id: `c-${id}`,
		author: { id: authorId, nick: authorId, display_name: null, removed: false },
		body,
		mentions: [],
		created_at: Math.floor(Date.now() / 1000),
		kind: "text",
		edited_at: null,
		reply_to: null,
		reactions: [],
		pinned_at: null,
		call: null,
	};
}

function conversation(
	id: string,
	nick: string,
	last: Message | null,
	removed = false,
): Conversation {
	return {
		id,
		person: { id: nick, nick, display_name: null, removed },
		last_message: last,
		state: { last_read_id: null, unread: 0, mentions: 0, muted: false },
	};
}

function renderDms(path: string = paths.channel("geral")) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<DmList />
				<div className="relative">
					<DmDock />
				</div>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return client;
}

beforeEach(() => {
	localStorage.clear();
	clearOpenDms();
	clearUnread();
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	vi.mocked(listPeople).mockResolvedValue([
		{ ...kid, online: true, status: "available" },
		person("ana"),
		person("bia", false),
		person("duda"),
	]);
	vi.mocked(listDms).mockResolvedValue([
		conversation("d-ana", "ana", message("m2", "d-ana", "kid", "fechou, depois da live")),
		conversation("d-bia", "bia", message("m1", "d-bia", "bia", "manda o link")),
	]);
	vi.mocked(listMessages).mockResolvedValue({
		messages: [message("m2", "d-ana", "kid", "fechou, depois da live")],
		has_more: false,
	});
	vi.mocked(openDm).mockReset();
	vi.mocked(sendMessage).mockReset();
});

describe("a aba Conversas", () => {
	it("lista as conversas, a mais recente em cima, com o começo da última mensagem", async () => {
		renderDms();
		const nav = await screen.findByRole("navigation", { name: "Conversas" });
		const rows = within(nav).getAllByRole("button");
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("ana"),
			expect.stringContaining("bia"),
		]);
		expect(within(rows[0]).getByText("Você: fechou, depois da live")).toBeInTheDocument();
		expect(within(rows[1]).getByText("manda o link")).toBeInTheDocument();
		// Sem busca, e com conversas, ninguém aparece para "começar".
		expect(
			screen.queryByRole("region", { name: "Começar uma conversa" }),
		).not.toBeInTheDocument();
	});

	it("as não lidas: a conversa sobe, ganha o número, e o número vai junto para a aba de baixo", async () => {
		vi.mocked(listDms).mockResolvedValue([
			conversation("d-ana", "ana", message("m2", "d-ana", "kid", "fechou")),
			{
				...conversation("d-bia", "bia", message("m1", "d-bia", "bia", "manda o link")),
				state: { last_read_id: null, unread: 2, mentions: 0, muted: false },
			},
		]);
		renderDms();
		const nav = await screen.findByRole("navigation", { name: "Conversas" });
		const rows = within(nav).getAllByRole("button");
		expect(rows[0]).toHaveTextContent("bia");
		expect(within(rows[0]).getByLabelText("2 não lidas")).toBeInTheDocument();
		expect(within(rows[1]).queryByLabelText(/não lidas/)).not.toBeInTheDocument();

		// Aberta e minimizada, a aba de baixo mostra o mesmo número.
		showDm("d-ana");
		showDm("d-bia");
		useOpenDms.setState({ active: "d-ana" });
		const tab = await screen.findByRole("button", { name: /Abrir conversa com bia/ });
		expect(within(tab).getByLabelText("2 não lidas")).toBeInTheDocument();

		// Lido em outro lugar (o channel.state), some dos dois.
		useUnreadStore.setState((s) => ({
			byChannel: {
				...s.byChannel,
				"d-bia": { last_read_id: "m1", unread: 0, mentions: 0, muted: false },
			},
		}));
		await waitFor(() =>
			expect(screen.queryByLabelText("2 não lidas")).not.toBeInTheDocument(),
		);
	});

	it("a busca filtra as conversas e oferece quem ainda não tem uma", async () => {
		const user = userEvent.setup();
		vi.mocked(openDm).mockResolvedValue(conversation("d-duda", "duda", null));
		renderDms();
		await screen.findByRole("navigation", { name: "Conversas" });

		await user.type(screen.getByRole("searchbox", { name: "Buscar conversa" }), "d");
		// "d" não está em "ana" nem em "bia": sobra só quem dá para começar.
		expect(screen.queryByRole("navigation", { name: "Conversas" })).not.toBeInTheDocument();
		const start = screen.getByRole("region", { name: "Começar uma conversa" });
		await user.click(within(start).getByRole("button", { name: /duda/ }));

		expect(openDm).toHaveBeenCalledWith({ user_id: "duda" });
		expect(
			await screen.findByRole("region", { name: "Conversa com duda" }),
		).toBeInTheDocument();
		// A conversa vazia não vira linha da lista.
		await waitFor(() =>
			expect(screen.getByRole("searchbox", { name: "Buscar conversa" })).toHaveValue(""),
		);
		const nav = screen.getByRole("navigation", { name: "Conversas" });
		expect(within(nav).queryByText("duda")).not.toBeInTheDocument();
	});

	it("sem nenhuma conversa, já oferece os membros", async () => {
		vi.mocked(listDms).mockResolvedValue([]);
		renderDms();
		const start = await screen.findByRole("region", { name: "Começar uma conversa" });
		// Em ordem de nome, sem você mesmo. O texto do botão leva a inicial
		// do avatar na frente, então a conferência é pelo nome acessível.
		expect(within(start).getAllByRole("button")).toEqual(
			["ana", "bia", "duda"].map((nick) =>
				within(start).getByRole("button", { name: new RegExp(nick) }),
			),
		);
	});
});

describe("a janela da conversa", () => {
	it("clicar numa conversa abre a janela, com o histórico, o aviso e o campo com o foco", async () => {
		const user = userEvent.setup();
		renderDms();
		const nav = await screen.findByRole("navigation", { name: "Conversas" });
		await user.click(within(nav).getByRole("button", { name: /ana/ }));

		const window = await screen.findByRole("region", { name: "Conversa com ana" });
		expect(within(window).getByText("Online")).toBeInTheDocument();
		expect(await within(window).findByText("fechou, depois da live")).toBeInTheDocument();
		expect(
			within(window).getByText(/não são criptografadas de ponta a ponta/),
		).toBeInTheDocument();
		expect(listMessages).toHaveBeenCalledWith("d-ana", {});
		const field = within(window).getByRole("textbox", { name: "Mensagem para ana" });
		expect(field).toHaveFocus();

		// Mandar usa a rota de mensagens de sempre, com o id da conversa.
		vi.mocked(sendMessage).mockResolvedValue(message("m3", "d-ana", "kid", "bora"));
		await user.type(field, "bora{Enter}");
		expect(sendMessage).toHaveBeenCalledWith("d-ana", {
			client_id: expect.any(String),
			body: "bora",
		});
	});

	it("minimizar vira aba, clicar na aba expande, e o Esc fecha", async () => {
		const user = userEvent.setup();
		renderDms();
		await screen.findByRole("navigation", { name: "Conversas" });
		showDm("d-ana");
		const window = await screen.findByRole("region", { name: "Conversa com ana" });

		await user.click(within(window).getByRole("button", { name: "Minimizar conversa" }));
		expect(screen.queryByRole("region", { name: "Conversa com ana" })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Abrir conversa com ana" }));
		const again = await screen.findByRole("region", { name: "Conversa com ana" });

		await user.click(within(again).getByRole("textbox"));
		await user.keyboard("{Escape}");
		expect(useOpenDms.getState()).toEqual({ open: [], active: null });
	});

	it("cabem três embaixo: a expandida, duas abas e o +N", async () => {
		vi.mocked(listDms).mockResolvedValue(
			["a", "b", "c", "d", "e"].map((nick, i) =>
				conversation(`d-${nick}`, nick, message(`m${i}`, `d-${nick}`, nick, "oi")),
			),
		);
		const user = userEvent.setup();
		renderDms();
		await screen.findByRole("navigation", { name: "Conversas" });
		for (const nick of ["a", "b", "c", "d", "e"]) showDm(`d-${nick}`);

		expect(await screen.findByRole("region", { name: "Conversa com e" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Abrir conversa com d" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Abrir conversa com c" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Abrir conversa com b" })).not.toBeInTheDocument();
		// O +N traz a próxima da fila.
		await user.click(screen.getByRole("button", { name: "Mais 2 conversas abertas" }));
		expect(await screen.findByRole("region", { name: "Conversa com b" })).toBeInTheDocument();
	});

	it("o sino silencia a conversa: o número some, a não ser pelas menções", async () => {
		const user = userEvent.setup();
		const unread = { last_read_id: null, unread: 3, mentions: 0, muted: false };
		vi.mocked(listDms).mockResolvedValue([
			{ ...conversation("d-bia", "bia", message("m1", "d-bia", "bia", "oi")), state: unread },
		]);
		vi.mocked(setMuted).mockResolvedValue({ ...unread, muted: true });
		renderDms();
		const nav = await screen.findByRole("navigation", { name: "Conversas" });
		expect(within(nav).getByLabelText("3 não lidas")).toBeInTheDocument();
		showDm("d-bia");
		useOpenDms.setState({ active: "d-bia" });

		const bell = await screen.findByRole("button", { name: "Silenciar conversa" });
		expect(bell).toHaveAttribute("aria-pressed", "false");
		await user.click(bell);
		expect(setMuted).toHaveBeenCalledWith("d-bia", { muted: true });
		expect(bell).toHaveAttribute("aria-pressed", "true");
		expect(within(nav).queryByLabelText(/não lidas/)).not.toBeInTheDocument();

		// Uma menção passa por cima.
		useUnreadStore.setState((s) => ({
			byChannel: { ...s.byChannel, "d-bia": { ...unread, muted: true, mentions: 1 } },
		}));
		expect(await within(nav).findByLabelText("1 não lida")).toBeInTheDocument();
	});

	it("com quem saiu do grupo, é só para leitura", async () => {
		vi.mocked(listDms).mockResolvedValue([
			conversation("d-ana", "ana", message("m2", "d-ana", "ana", "tchau"), true),
		]);
		renderDms();
		await screen.findByRole("navigation", { name: "Conversas" });
		showDm("d-ana");
		const window = await screen.findByRole("region", { name: "Conversa com ana" });
		expect(within(window).getByText("Saiu do grupo")).toBeInTheDocument();
		expect(
			within(window).getByText("ana saiu do grupo. A conversa fica só para leitura."),
		).toBeInTheDocument();
		expect(within(window).queryByRole("textbox")).not.toBeInTheDocument();
	});

	it("nas configurações as janelas não aparecem, e um id desconhecido não vira janela", async () => {
		showDm("d-ana");
		showDm("de-outra-conta");
		renderDms(paths.settings.profile);
		await screen.findByRole("navigation", { name: "Conversas" });
		expect(screen.queryByRole("region", { name: /Conversa com/ })).not.toBeInTheDocument();
	});
});

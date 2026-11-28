import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { channelsKeys } from "@/features/channels";
import { identityKeys, useSessionStore } from "@/features/identity";
import {
	deleteMessage,
	editMessage,
	getChannelLayout,
	type Layout,
	listMessages,
	listPeople,
	listVoiceParticipants,
	type Message,
	sendMessage,
	setReaction,
	type UserView,
} from "@/lib/api";
import { ChatView } from "../components/ChatView";
import { chatKeys } from "../queries";
import { handleChatRealtime } from "../realtime";
import { useDrafts } from "../stores/draftStore";
import { useOutbox } from "../stores/outboxStore";
import { useRecentEmoji } from "@/features/emojis";
import { useReplyStore } from "../stores/replyStore";

const THUMBS = "\u{1F44D}\u{FE0F}";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getChannelLayout: vi.fn(),
	listMessages: vi.fn(),
	listPeople: vi.fn(),
	listVoiceParticipants: vi.fn(),
	sendMessage: vi.fn(),
	editMessage: vi.fn(),
	deleteMessage: vi.fn(),
	setReaction: vi.fn(),
}));
vi.mock("@/lib/tauri/opener", () => ({ openLink: vi.fn() }));

const kid: UserView = {
	id: "u1",
	nick: "kid",
	display_name: "Kid",
	is_owner: true,
};

const layout: Layout = {
	version: 1,
	top: [],
	categories: [
		{
			id: "texto",
			name: "Texto",
			channels: [
				{
					id: "geral",
					kind: "text",
					name: "geral",
					topic: null,
					category_id: "texto",
					archived_at: null,
					restricted: false,
				},
			],
		},
	],
};

const now = Math.floor(Date.now() / 1000);

function message(
	id: string,
	body: string,
	author: "kid" | "ana",
	extra: Partial<Message> = {},
): Message {
	return {
		id,
		channel_id: "geral",
		client_id: id,
		author:
			author === "kid"
				? { id: "u1", nick: "kid", display_name: "Kid", removed: false }
				: { id: "u2", nick: "ana", display_name: null, removed: false },
		body,
		mentions: [],
		created_at: now - 600 + Number(id.slice(1)) * 60,
		kind: "text",
		edited_at: null,
		reply_to: null,
		reactions: [],
		pinned_at: null,
		attachments: [],
		previews: [],
		forwarded: null,
		call: null,
		...extra,
	};
}

const fromAna = message("m1", "quem joga hoje?", "ana");
const fromKid = message("m2", "eu jogo", "kid");

function renderChat() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(identityKeys.me(), {
		user: kid,
		permissions: [],
		update_channel: "stable",
		status: "available",
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: true,
		can_move_members: true, can_manage_emojis: false, can_view_logs: false, can_moderate_voice: false, can_send_sounds: false, can_approve_sounds: false, can_stream_from_device: false,
	});
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<ChatView channelId="geral" />
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return client;
}

/** A linha da mensagem com este texto. */
async function row(text: string): Promise<HTMLElement> {
	const found = await screen.findByText(text);
	const li = found.closest("li[data-message-id]");
	if (!(li instanceof HTMLElement)) throw new Error(`sem linha: ${text}`);
	return li;
}

async function openMore(user: ReturnType<typeof userEvent.setup>, text: string) {
	await user.click(
		within(await row(text)).getByRole("button", { name: "Mais" }),
	);
}

beforeEach(() => {
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	useDrafts.setState({ drafts: {} });
	useOutbox.setState({ pending: [] });
	useReplyStore.setState({ byChannel: {} });
	useRecentEmoji.setState({ recent: [] });
	vi.mocked(getChannelLayout).mockResolvedValue(layout);
	vi.mocked(listMessages).mockResolvedValue({
		messages: [fromAna, fromKid],
		has_more: false,
	});
	vi.mocked(listPeople).mockResolvedValue([
		{
			id: "u1",
			nick: "kid",
			display_name: "Kid",
			is_owner: true,
			online: true,
			status: "available",
		},
		{
			id: "u2",
			nick: "ana",
			display_name: null,
			is_owner: false,
			online: true,
			status: "available",
		},
	]);
	vi.mocked(listVoiceParticipants).mockResolvedValue([]);
	vi.mocked(sendMessage).mockReset();
	vi.mocked(editMessage).mockReset();
	vi.mocked(deleteMessage).mockReset();
	vi.mocked(setReaction).mockReset();
});

describe("as ações da mensagem", () => {
	it("edita a própria no lugar, com Enter, e mostra (editada)", async () => {
		vi.mocked(editMessage).mockImplementation(async (_id, { body }) => ({
			...fromKid,
			body,
			edited_at: now,
		}));
		const user = userEvent.setup();
		renderChat();

		await openMore(user, "eu jogo");
		await user.click(
			await screen.findByRole("menuitem", { name: "Editar mensagem" }),
		);
		const field = screen.getByRole("textbox", { name: "Editar mensagem" });
		await user.clear(field);
		await user.type(field, "eu jogo às 21h{Enter}");

		expect(editMessage).toHaveBeenCalledWith("m2", { body: "eu jogo às 21h" });
		expect(await screen.findByText("eu jogo às 21h")).toBeInTheDocument();
		expect(screen.getByText("(editada)")).toBeInTheDocument();
		expect(
			screen.queryByRole("textbox", { name: "Editar mensagem" }),
		).not.toBeInTheDocument();
	});

	it("só a própria tem Editar; Esc cancela sem mandar nada", async () => {
		const user = userEvent.setup();
		renderChat();

		await openMore(user, "quem joga hoje?");
		expect(
			await screen.findByRole("menuitem", { name: "Responder" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("menuitem", { name: "Editar mensagem" }),
		).not.toBeInTheDocument();
		await user.keyboard("{Escape}");

		// A seta para cima no campo vazio edita a última de quem escreve.
		await user.click(screen.getByRole("textbox", { name: "Mensagem para #geral" }));
		await user.keyboard("{ArrowUp}");
		const field = await screen.findByRole("textbox", { name: "Editar mensagem" });
		expect(field).toHaveValue("eu jogo");
		await user.keyboard("{Escape}");
		expect(field).not.toBeInTheDocument();
		expect(editMessage).not.toHaveBeenCalled();
	});

	it("excluir pede confirmação, e o dono exclui a dos outros num canal", async () => {
		vi.mocked(deleteMessage).mockResolvedValue();
		const user = userEvent.setup();
		renderChat();

		await openMore(user, "quem joga hoje?");
		await user.click(
			await screen.findByRole("menuitem", { name: "Excluir mensagem" }),
		);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Excluir mensagem")).toBeInTheDocument();
		await user.click(within(dialog).getByRole("button", { name: "Excluir" }));

		expect(deleteMessage).toHaveBeenCalledWith("m1");
		await waitFor(() =>
			expect(screen.queryByText("quem joga hoje?")).not.toBeInTheDocument(),
		);
	});

	it("responder põe a faixa, manda o reply_to e o @ pode ser desligado", async () => {
		vi.mocked(sendMessage).mockImplementation(async (_channel, request) =>
			message("m3", request.body, "kid", {
				client_id: request.client_id,
				reply_to: { id: "m1", author: fromAna.author, excerpt: fromAna.body },
			}),
		);
		const user = userEvent.setup();
		renderChat();

		await user.click(
			within(await row("quem joga hoje?")).getByRole("button", {
				name: "Responder",
			}),
		);
		expect(screen.getByText(/Respondendo a/)).toHaveTextContent(
			"Respondendo a ana",
		);
		const mention = screen.getByRole("button", { pressed: true });
		await user.click(mention);
		expect(mention).toHaveAttribute("aria-pressed", "false");
		await user.type(
			screen.getByRole("textbox", { name: "Mensagem para #geral" }),
			"eu{Enter}",
		);

		expect(sendMessage).toHaveBeenCalledWith(
			"geral",
			expect.objectContaining({
				body: "eu",
				reply_to: "m1",
				reply_mention: false,
			}),
		);
		expect(screen.queryByText(/Respondendo a/)).not.toBeInTheDocument();
		// A resposta mostra a citação, que leva até a original.
		expect(
			await screen.findByRole("button", {
				name: "Ir para a mensagem de ana: quem joga hoje?",
			}),
		).toBeInTheDocument();
	});

	it("a citação de uma mensagem fora do histórico abre o histórico em volta dela", async () => {
		const old = message("m0", "mensagem antiga", "ana");
		vi.mocked(listMessages).mockImplementation(async (_channel, cursor) =>
			cursor?.around
				? { messages: [old], has_more: false, has_newer: true }
				: {
						messages: [
							message("m3", "respondendo", "kid", {
								reply_to: { id: "m0", author: old.author, excerpt: old.body },
							}),
						],
						has_more: true,
					},
		);
		const user = userEvent.setup();
		renderChat();

		await user.click(
			await screen.findByRole("button", {
				name: "Ir para a mensagem de ana: mensagem antiga",
			}),
		);

		expect(listMessages).toHaveBeenCalledWith("geral", { around: "m0" });
		expect(await screen.findByText("mensagem antiga")).toBeInTheDocument();
		expect(
			screen.getByText("Você está vendo mensagens antigas"),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Ir para o presente" }));
		expect(await screen.findByText("respondendo")).toBeInTheDocument();
		expect(
			screen.queryByText("Você está vendo mensagens antigas"),
		).not.toBeInTheDocument();
	});

	it("uma reação rápida da barra chama a API e aparece embaixo", async () => {
		vi.mocked(setReaction).mockResolvedValue({
			...fromAna,
			reactions: [{ emoji: THUMBS, users: ["u1"] }],
		});
		const user = userEvent.setup();
		renderChat();

		await user.click(
			within(await row("quem joga hoje?")).getByRole("button", {
				name: "Reagir com polegar",
			}),
		);

		expect(setReaction).toHaveBeenCalledWith("m1", THUMBS, true);
		const chip = await screen.findByRole("button", {
			name: `Reação ${THUMBS}, 1 pessoa, incluindo você`,
		});
		expect(chip).toHaveAttribute("aria-pressed", "true");

		// Clicar de novo tira.
		vi.mocked(setReaction).mockResolvedValue(fromAna);
		await user.click(chip);
		expect(setReaction).toHaveBeenLastCalledWith("m1", THUMBS, false);
	});

	it("o seletor busca sem acento, reage e guarda nos Recentes", async () => {
		vi.mocked(setReaction).mockResolvedValue(fromAna);
		const user = userEvent.setup();
		renderChat();

		await user.click(
			within(await row("quem joga hoje?")).getByRole("button", {
				name: "Reagir",
			}),
		);
		const picker = await screen.findByRole("dialog", { name: "Escolher emoji" });
		await user.type(
			within(picker).getByRole("searchbox", { name: "Buscar emoji" }),
			"cafe",
		);
		await user.click(await within(picker).findByRole("button", { name: "café" }));

		expect(setReaction).toHaveBeenCalledWith("m1", "☕️", true);
		expect(useRecentEmoji.getState().recent[0]).toBe("☕️");
		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Escolher emoji" }),
			).not.toBeInTheDocument(),
		);
	});
});

describe("os eventos de mensagem editada e excluída", () => {
	function seeded() {
		const client = new QueryClient();
		client.setQueryData(channelsKeys.layout(), layout);
		const reply = message("m3", "eu", "kid", {
			reply_to: { id: "m1", author: fromAna.author, excerpt: fromAna.body },
		});
		client.setQueryData(chatKeys.messages("geral"), {
			pages: [{ messages: [fromAna, fromKid, reply], has_more: false }],
			pageParams: [null],
		});
		return client;
	}
	const info = { resumed: false };
	const cached = (client: QueryClient) =>
		client.getQueryData<{ pages: { messages: Message[] }[] }>(
			chatKeys.messages("geral"),
		)?.pages[0].messages ?? [];

	it("message.updated troca a mensagem e a citação das respostas", () => {
		const client = seeded();
		handleChatRealtime(
			{
				type: "message.updated",
				message: { ...fromAna, body: "quem   joga\nagora?", edited_at: now },
				new_mentions: [],
			},
			client,
			info,
		);
		const [first, , reply] = cached(client);
		expect(first.body).toBe("quem   joga\nagora?");
		expect(reply.reply_to?.excerpt).toBe("quem joga agora?");
	});

	it("message.deleted tira a mensagem e a resposta fica sem a original", () => {
		const client = seeded();
		useReplyStore.setState({
			byChannel: { geral: { message: fromAna, mention: true } },
		});
		handleChatRealtime(
			{ type: "message.deleted", channel_id: "geral", message_id: "m1" },
			client,
			info,
		);
		const messages = cached(client);
		expect(messages.map((m) => m.id)).toEqual(["m2", "m3"]);
		expect(messages[1].reply_to).toEqual({ id: "m1", author: null, excerpt: null });
		expect(useReplyStore.getState().byChannel.geral).toBeUndefined();
	});
});

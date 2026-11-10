import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelDialog } from "@/features/channels";
import { identityKeys, useSessionStore } from "@/features/identity";
import {
	ApiError,
	getChannelLayout,
	type Layout,
	listMessages,
	listPeople,
	listVoiceParticipants,
	type Message,
	sendMessage,
	type UserView,
} from "@/lib/api";
import { ChatView } from "../components/ChatView";
import { useDrafts } from "../stores/draftStore";
import { useOutbox } from "../stores/outboxStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getChannelLayout: vi.fn(),
	listMessages: vi.fn(),
	listPeople: vi.fn(),
	listVoiceParticipants: vi.fn(),
	sendMessage: vi.fn(),
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
					topic: "Conversa geral do grupo",
					category_id: "texto",
					archived_at: null,
				},
			],
		},
	],
};

function message(id: string, body: string, clientId = id): Message {
	return {
		id,
		channel_id: "geral",
		client_id: clientId,
		author: { id: "u2", nick: "ana", display_name: null, removed: true },
		body,
		created_at: Math.floor(Date.now() / 1000),
	};
}

function renderChat(channelId = "geral", { manage = false } = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(identityKeys.me(), {
		user: kid,
		permissions: [],
		update_channel: "stable",
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: manage,
	});
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<ChatView channelId={channelId} />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	useDrafts.setState({ drafts: {} });
	useOutbox.setState({ pending: [] });
	vi.mocked(getChannelLayout).mockResolvedValue(layout);
	vi.mocked(listMessages).mockResolvedValue({
		messages: [message("m1", "oi, grupo")],
		has_more: false,
	});
	vi.mocked(listPeople).mockResolvedValue([
		{
			id: "u1",
			nick: "kid",
			display_name: "Kid",
			is_owner: true,
			online: true,
		},
		{
			id: "u2",
			nick: "ana",
			display_name: null,
			is_owner: false,
			online: true,
		},
		{
			id: "u3",
			nick: "bia",
			display_name: null,
			is_owner: false,
			online: false,
		},
	]);
	vi.mocked(listVoiceParticipants).mockResolvedValue([
		{ user_id: "u1", nick: "kid", display_name: "Kid", screen_sharing: false },
	]);
	vi.mocked(sendMessage).mockReset();
});

describe("ChatView", () => {
	it("mostra o canal, o tópico, a conversa e os membros", async () => {
		renderChat();
		expect(
			await screen.findByRole("heading", { name: "geral" }),
		).toBeInTheDocument();
		expect(screen.getByText("Conversa geral do grupo")).toBeInTheDocument();
		expect(await screen.findByText("oi, grupo")).toBeInTheDocument();
		expect(screen.getByText("(saiu do grupo)")).toBeInTheDocument();
		expect(screen.getByText("Bem-vindo a #geral")).toBeInTheDocument();

		// O dono online fica sozinho em cima, com a coroa; o resto de quem está online vem abaixo;
		// o Offline segue como estava.
		const owner = await screen.findByRole("region", { name: "Dono" });
		expect(within(owner).getByText("Kid")).toBeInTheDocument();
		expect(await within(owner).findByText("Na Sala")).toBeInTheDocument();
		expect(within(owner).queryByText("ana")).not.toBeInTheDocument();
		const rest = screen.getByRole("region", { name: "Resto" });
		expect(within(rest).getByText("ana")).toBeInTheDocument();
		expect(within(rest).queryByText("Kid")).not.toBeInTheDocument();
		expect(within(rest).getByRole("heading")).toHaveTextContent("Resto — 1");
		const offline = screen.getByRole("region", { name: "Offline" });
		expect(within(offline).getByText("bia")).toBeInTheDocument();
		// Quem está offline fica apagado, com o avatar e o nome juntos; quem está online, não.
		expect(within(offline).getByText("bia").closest("li")).toHaveClass(
			"opacity-50",
		);
		expect(within(rest).getByText("ana").closest("li")).not.toHaveClass(
			"opacity-50",
		);
		expect(within(owner).getByText("Kid").closest("li")).not.toHaveClass(
			"opacity-50",
		);
	});

	it("quem gerencia os canais clica no tópico e abre o Editar já nele", async () => {
		useChannelDialog.setState({ dialog: null });
		const user = userEvent.setup();
		renderChat("geral", { manage: true });

		await user.click(
			await screen.findByRole("button", { name: "Editar o tópico" }),
		);

		expect(useChannelDialog.getState().dialog).toMatchObject({
			kind: "editChannel",
			channel: { id: "geral" },
			focus: "topic",
		});
	});

	it("sem tópico, quem gerencia vê Adicionar um tópico", async () => {
		vi.mocked(getChannelLayout).mockResolvedValue({
			...layout,
			categories: [
				{
					...layout.categories[0],
					channels: [{ ...layout.categories[0].channels[0], topic: null }],
				},
			],
		});
		renderChat("geral", { manage: true });
		expect(
			await screen.findByRole("button", { name: "Adicionar um tópico" }),
		).toBeInTheDocument();
	});

	it("Enter manda na hora, apagada até a API confirmar", async () => {
		let confirm: (message: Message) => void = () => {};
		vi.mocked(sendMessage).mockImplementation(
			(_channel, request) =>
				new Promise((resolve) => {
					confirm = () =>
						resolve(message("m2", request.body, request.client_id));
				}),
		);
		renderChat();
		const field = await screen.findByRole("textbox", {
			name: "Mensagem para #geral",
		});
		await userEvent.type(field, "  bora jogar?  {Enter}");

		expect(field).toHaveValue("");
		const pending = screen.getByText("bora jogar?").closest("li");
		expect(pending).toHaveAttribute("aria-busy", "true");
		expect(sendMessage).toHaveBeenCalledWith("geral", {
			client_id: expect.any(String),
			body: "bora jogar?",
		});

		confirm(message("m2", "bora jogar?"));
		await vi.waitFor(() =>
			expect(screen.getByText("bora jogar?").closest("li")).not.toHaveAttribute(
				"aria-busy",
			),
		);
		expect(screen.getAllByText("bora jogar?")).toHaveLength(1);
	});

	it("Shift+Enter quebra a linha, e campo vazio não manda", async () => {
		renderChat();
		const field = await screen.findByRole("textbox", {
			name: "Mensagem para #geral",
		});
		await userEvent.type(field, "{Enter}");
		expect(sendMessage).not.toHaveBeenCalled();
		await userEvent.type(field, "a{Shift>}{Enter}{/Shift}b");
		expect(field).toHaveValue("a\nb");
	});

	it("o envio que falha fica com Tentar de novo, com o mesmo client_id", async () => {
		vi.mocked(sendMessage)
			.mockRejectedValueOnce(
				new ApiError({
					status: 429,
					kind: "too_many_messages",
					message: "Calma: muitas mensagens seguidas.",
				}),
			)
			.mockImplementationOnce((_channel, request) =>
				Promise.resolve(message("m2", request.body, request.client_id)),
			);
		renderChat();
		const field = await screen.findByRole("textbox", {
			name: "Mensagem para #geral",
		});
		await userEvent.type(field, "oi{Enter}");

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Calma: muitas mensagens seguidas.");
		fireEvent.click(
			within(alert).getByRole("button", { name: "Tentar de novo" }),
		);
		await vi.waitFor(() =>
			expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
		);

		const [first, second] = vi.mocked(sendMessage).mock.calls;
		expect(second[1].client_id).toBe(first[1].client_id);
	});

	it("o rascunho fica guardado por canal", async () => {
		renderChat();
		const field = await screen.findByRole("textbox", {
			name: "Mensagem para #geral",
		});
		await userEvent.type(field, "pela metade");
		expect(useDrafts.getState().drafts).toEqual({ geral: "pela metade" });
	});

	it("o dono fica sempre no topo, mesmo offline", async () => {
		vi.mocked(listPeople).mockResolvedValue([
			{
				id: "u1",
				nick: "kid",
				display_name: "Kid",
				is_owner: true,
				online: false,
			},
			{
				id: "u2",
				nick: "ana",
				display_name: null,
				is_owner: false,
				online: true,
			},
		]);
		renderChat();
		const owner = await screen.findByRole("region", { name: "Dono" });
		expect(within(owner).getByText("Kid")).toBeInTheDocument();
		// O dono offline continua no topo, só que apagado, com as cores de sempre.
		expect(within(owner).getByText("Kid").closest("li")).toHaveClass(
			"opacity-50",
		);
		const rest = screen.getByRole("region", { name: "Resto" });
		expect(within(rest).getByText("ana")).toBeInTheDocument();
		// Sem ninguém offline além do dono, o grupo Offline nem aparece.
		expect(
			screen.queryByRole("region", { name: "Offline" }),
		).not.toBeInTheDocument();
		// A ordem na coluna: Dono, Resto.
		const regions = screen
			.getAllByRole("region")
			.map((region) => region.getAttribute("aria-label"));
		expect(regions.indexOf("Dono")).toBeLessThan(regions.indexOf("Resto"));
	});

	it("canal arquivado oferece voltar para o #geral", async () => {
		renderChat("arquivado");
		expect(
			await screen.findByText("Esse canal não está mais aqui"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Ir para o #geral" }),
		).toBeInTheDocument();
	});
});

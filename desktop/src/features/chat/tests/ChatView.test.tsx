import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { channelsKeys, useChannelDialog } from "@/features/channels";
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
					restricted: false,
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

function renderChat(channelId = "geral", { manage = false } = {}) {
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
		can_manage_channels: manage,
		can_move_members: manage,
	});
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<ChatView channelId={channelId} />
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return client;
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
		{
			id: "u3",
			nick: "bia",
			display_name: null,
			is_owner: false,
			online: false,
			status: "available",
		},
	]);
	vi.mocked(listVoiceParticipants).mockResolvedValue([
		{ user_id: "u1", nick: "kid", display_name: "Kid", screen_sharing: false },
	]);
	vi.mocked(sendMessage).mockReset();
});

describe("ChatView", () => {
	it("mostra o canal, o tópico e a conversa", async () => {
		renderChat();
		expect(
			await screen.findByRole("heading", { name: "geral" }),
		).toBeInTheDocument();
		expect(screen.getByText("Conversa geral do grupo")).toBeInTheDocument();
		expect(await screen.findByText("oi, grupo")).toBeInTheDocument();
		expect(screen.getByText("(saiu do grupo)")).toBeInTheDocument();
		expect(screen.getByText("Bem-vindo a #geral")).toBeInTheDocument();
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

describe("perder o acesso ao canal aberto", () => {
	it("volta para o primeiro canal, com o aviso, e esquece o rascunho", async () => {
		const staff = {
			...layout.categories[0].channels[0],
			id: "staff",
			name: "staff",
			topic: null,
			restricted: true,
			member_ids: ["u1"],
		};
		const withStaff: Layout = {
			...layout,
			categories: [
				{
					...layout.categories[0],
					channels: [...layout.categories[0].channels, staff],
				},
			],
		};
		vi.mocked(getChannelLayout).mockResolvedValue(withStaff);
		useDrafts.setState({ drafts: { staff: "meio escrito" } });
		const add = vi.spyOn(toast, "add");
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/channels/staff"]}>
					<Routes>
						<Route
							path="/channels/staff"
							element={<ChatView channelId="staff" />}
						/>
						<Route path="*" element={<p>outra tela</p>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);
		expect(
			await screen.findByRole("heading", { name: "staff" }),
		).toBeInTheDocument();

		client.setQueryData(channelsKeys.layout(), { ...layout, version: 2 });
		await vi.waitFor(() =>
			expect(add).toHaveBeenCalledWith(
				expect.objectContaining({
					title: "Você não tem mais acesso a #staff",
				}),
			),
		);
		expect(useDrafts.getState().drafts.staff).toBeUndefined();
		add.mockRestore();
	});
});

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
	fetchFile,
	getChannelLayout,
	type Layout,
	listChannelFiles,
	listMessages,
	listPeople,
	listPins,
	listVoiceParticipants,
	type Message,
	searchMessages,
	sendMessage,
	setPinned,
	type UserView,
} from "@/lib/api";
import { ChatView } from "../components/ChatView";
import { useDrafts } from "../stores/draftStore";
import { useOutbox } from "../stores/outboxStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
	getChannelLayout: vi.fn(),
	listChannelFiles: vi.fn(),
	listMessages: vi.fn(),
	listPeople: vi.fn(),
	listPins: vi.fn(),
	listVoiceParticipants: vi.fn(),
	searchMessages: vi.fn(),
	sendMessage: vi.fn(),
	setPinned: vi.fn(),
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
		attachments: [],
		previews: [],
		forwarded: null,
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
		can_move_members: manage, can_manage_emojis: false, can_view_logs: false, can_moderate_voice: false, can_send_sounds: false, can_approve_sounds: false, can_stream_from_device: false,
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
		{ user_id: "u1", nick: "kid", display_name: "Kid", screen_sharing: false, mic_off: false, deafened: false, camera: false, server_muted: false, server_deafened: false, sounds_blocked: false },
	]);
	vi.mocked(sendMessage).mockReset();
	vi.mocked(listPins).mockResolvedValue([]);
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

	it("arrastar arquivos mostra o Solte para enviar, e sair dela o esconde", async () => {
		renderChat();
		const list = await screen.findByText("oi, grupo");
		const file = new File(["x"], "foto.png", { type: "image/png" });
		const dataTransfer = {
			types: ["Files"],
			items: [{ kind: "file" }, { kind: "file" }],
			files: [file],
			dropEffect: "none",
		};
		fireEvent.dragEnter(list, { dataTransfer });
		expect(screen.getByText("Solte para enviar em #geral")).toBeInTheDocument();
		expect(screen.getByText(/^2 arquivos/)).toBeInTheDocument();
		fireEvent.dragLeave(list, { dataTransfer, relatedTarget: document.body });
		expect(screen.queryByText("Solte para enviar em #geral")).toBeNull();
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

	it("a faixa das fixadas abre a caixa; quem gerencia desafixa", async () => {
		const user = userEvent.setup();
		const pinned = { ...message("m1", "oi, grupo"), pinned_at: 10 };
		vi.mocked(listPins).mockResolvedValue([pinned]);
		vi.mocked(setPinned).mockResolvedValue({ ...pinned, pinned_at: null });
		renderChat("geral", { manage: true });
		await user.click(
			await screen.findByRole("button", {
				name: "1 mensagem fixada · clique para ver",
			}),
		);
		const box = await screen.findByRole("dialog", {
			name: "Mensagens fixadas",
		});
		expect(within(box).getByText("Ir até a mensagem")).toBeInTheDocument();
		await user.click(within(box).getByRole("button", { name: "Desafixar" }));
		expect(setPinned).toHaveBeenCalledWith("m1", false);
		await vi.waitFor(() =>
			expect(
				screen.queryByRole("button", { name: /mensagem fixada/ }),
			).not.toBeInTheDocument(),
		);
	});

	it("a busca sugere o filtro, mostra o resultado com o termo e vai até a mensagem", async () => {
		const user = userEvent.setup();
		vi.mocked(listPeople).mockResolvedValue([]);
		vi.mocked(searchMessages).mockResolvedValue({
			messages: [message("m9", "Você vai jogar hoje?")],
			has_more: false,
		});
		renderChat();
		const field = await screen.findByRole("combobox", {
			name: "Buscar no grupo",
		});
		await user.type(field, "tem:im");
		await user.click(await screen.findByRole("option", { name: "imagem" }));
		expect(field).toHaveValue("tem:imagem ");
		await user.type(field, "voce{Enter}");
		const box = await screen.findByRole("dialog", { name: "Resultados" });
		expect(searchMessages).toHaveBeenCalledWith({
			q: "voce",
			has: "image",
			channelId: "geral",
		});
		expect(within(box).getByText("Você").tagName).toBe("MARK");

		await user.click(within(box).getByRole("radio", { name: "Todo o grupo" }));
		await vi.waitFor(() =>
			expect(searchMessages).toHaveBeenLastCalledWith({
				q: "voce",
				has: "image",
			}),
		);
		await user.click(
			await within(box).findByRole("button", { name: /jogar hoje/ }),
		);
		await vi.waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Resultados" }),
			).not.toBeInTheDocument(),
		);
		// Não está no histórico carregado: abre o histórico em volta dela.
		await vi.waitFor(() =>
			expect(listMessages).toHaveBeenCalledWith("geral", { around: "m9" }),
		);
	});

	it("a mídia do canal mostra a grade e os arquivos, e a imagem vai até a mensagem", async () => {
		const user = userEvent.setup();
		vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"]));
		const author = { id: "u2", nick: "ana", display_name: null, removed: false };
		const file = (id: string, name: string, mime: string, thumb: string | null) => ({
			id,
			kind: "attachment" as const,
			name,
			mime,
			size: 2048,
			width: 800,
			height: 600,
			duration_ms: null,
			thumbnail_id: thumb,
		});
		vi.mocked(listChannelFiles).mockImplementation(async (_channel, filter) =>
			filter === "media"
				? {
						files: [
							{
								message_id: "m7",
								author,
								created_at: 10,
								file: file("f1", "foto.png", "image/png", "t1"),
							},
						],
						has_more: false,
					}
				: {
						files: [
							{
								message_id: "m8",
								author,
								created_at: 10,
								file: file("f2", "notas.pdf", "application/pdf", null),
							},
						],
						has_more: false,
					},
		);
		renderChat();
		await user.click(await screen.findByRole("button", { name: "Mídia do canal" }));
		const box = await screen.findByRole("dialog", { name: "Mídia" });
		await user.click(
			await within(box).findByRole("button", { name: "Abrir foto.png" }),
		);
		await user.click(
			await screen.findByRole("button", { name: "Ir até a mensagem" }),
		);
		await vi.waitFor(() =>
			expect(listMessages).toHaveBeenCalledWith("geral", { around: "m7" }),
		);

		await user.click(screen.getByRole("button", { name: "Mídia do canal" }));
		const again = await screen.findByRole("dialog", { name: "Mídia" });
		await user.click(within(again).getByRole("radio", { name: "Arquivos" }));
		expect(
			await within(again).findByRole("button", { name: "Baixar notas.pdf" }),
		).toBeInTheDocument();
		expect(listChannelFiles).toHaveBeenCalledWith("geral", "files", undefined);
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

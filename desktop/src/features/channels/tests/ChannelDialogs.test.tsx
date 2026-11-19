import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	archiveChannel,
	type ChannelView,
	createChannel,
	getChannelLayout,
	updateChannel,
} from "@/lib/api";
import { paths } from "@/lib/paths";
import { ChannelDialogs, previewTextName } from "../components/ChannelDialogs";
import { openChannelDialog, useChannelDialog } from "../stores/dialogStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createChannel: vi.fn(),
	updateChannel: vi.fn(),
	archiveChannel: vi.fn(),
	getChannelLayout: vi.fn(),
	getArchivedChannels: vi.fn(() => new Promise(() => {})),
}));

const lol: ChannelView = {
	id: "lol",
	kind: "text",
	name: "lol",
	topic: "Só ranqueada",
	category_id: "jogos",
	archived_at: null,
};

function renderDialogs(at: string = paths.channel("geral")) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const router = createMemoryRouter(
		[{ path: "*", element: <ChannelDialogs /> }],
		{ initialEntries: [at] },
	);
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

afterEach(() => {
	vi.clearAllMocks();
	act(() => useChannelDialog.setState({ dialog: null }));
});

describe("os diálogos de canais", () => {
	it("o nome mostra como vai ficar: minúsculas e - no lugar de espaço", () => {
		expect(previewTextName("  Jogos  Online ")).toBe("jogos-online");
		expect(previewTextName("   ")).toBe("");
	});

	it("Criar canal manda o nome e a categoria e abre o canal novo", async () => {
		vi.mocked(createChannel).mockResolvedValue({
			...lol,
			id: "novo",
			name: "jogos-online",
			topic: null,
		});
		vi.mocked(getChannelLayout).mockResolvedValue({
			version: 2,
			top: [],
			categories: [],
		});
		const user = userEvent.setup();
		const router = renderDialogs();
		act(() =>
			openChannelDialog({ kind: "createChannel", categoryId: "jogos" }),
		);

		await user.type(await screen.findByLabelText("Nome"), "Jogos Online");
		expect(
			screen.getByText("Vai aparecer como #jogos-online."),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Criar canal" }));

		expect(createChannel).toHaveBeenCalledWith({
			kind: "text",
			name: "Jogos Online",
			category_id: "jogos",
			topic: undefined,
		});
		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(paths.channel("novo")),
		);
		expect(useChannelDialog.getState().dialog).toBeNull();
	});

	it("Criar sala de voz manda o tipo, sem tópico, e não sai da tela", async () => {
		vi.mocked(createChannel).mockResolvedValue({
			id: "squad",
			kind: "voice",
			name: "Squad do Kid",
			topic: null,
			category_id: "voz",
			archived_at: null,
		});
		vi.mocked(getChannelLayout).mockResolvedValue({
			version: 2,
			top: [],
			categories: [],
		});
		const user = userEvent.setup();
		const router = renderDialogs();
		act(() => openChannelDialog({ kind: "createChannel", categoryId: "voz" }));

		await user.click(await screen.findByRole("radio", { name: /Voz/ }));
		expect(
			screen.getByRole("heading", { name: "Criar sala de voz" }),
		).toBeInTheDocument();
		// Sala de voz não tem tópico, e o nome não vira #nome.
		expect(screen.queryByLabelText("Tópico (opcional)")).not.toBeInTheDocument();
		await user.type(screen.getByLabelText("Nome"), "Squad do Kid");
		expect(screen.queryByText(/Vai aparecer como/)).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Criar sala" }));

		expect(createChannel).toHaveBeenCalledWith({
			kind: "voice",
			name: "Squad do Kid",
			category_id: "voz",
			topic: undefined,
		});
		await vi.waitFor(() =>
			expect(useChannelDialog.getState().dialog).toBeNull(),
		);
		expect(router.state.location.pathname).toBe(paths.channel("geral"));
	});

	it("pelo cabeçalho, o Editar abre já no tópico", async () => {
		vi.mocked(updateChannel).mockResolvedValue({ ...lol, topic: null });
		const user = userEvent.setup();
		renderDialogs(paths.channel("lol"));
		act(() =>
			openChannelDialog({ kind: "editChannel", channel: lol, focus: "topic" }),
		);

		const topic = await screen.findByLabelText("Tópico");
		expect(topic).toHaveFocus();
		await user.clear(topic);
		await user.click(screen.getByRole("button", { name: "Salvar" }));

		expect(updateChannel).toHaveBeenCalledWith("lol", {
			name: "lol",
			topic: "",
		});
	});

	it("a sala de voz só renomeia: não tem tópico", async () => {
		renderDialogs();
		act(() =>
			openChannelDialog({
				kind: "editChannel",
				channel: {
					...lol,
					id: "sala",
					kind: "voice",
					name: "Sala",
					topic: null,
				},
			}),
		);

		expect(
			await screen.findByRole("heading", { name: "Editar Sala" }),
		).toBeInTheDocument();
		expect(screen.queryByLabelText("Tópico")).toBeNull();
	});

	it("arquivar o canal aberto leva para o #geral", async () => {
		vi.mocked(archiveChannel).mockResolvedValue();
		vi.mocked(getChannelLayout).mockResolvedValue({
			version: 2,
			top: [],
			categories: [],
		});
		const user = userEvent.setup();
		const router = renderDialogs(paths.channel("lol"));
		act(() => openChannelDialog({ kind: "archiveChannel", channel: lol }));

		expect(await screen.findByText("Arquivar #lol?")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Arquivar" }));

		expect(archiveChannel).toHaveBeenCalledWith("lol");
		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(paths.channel("geral")),
		);
	});

	it("a API recusando, o erro aparece e o diálogo fica aberto", async () => {
		const { ApiError } = await import("@/lib/api");
		vi.mocked(createChannel).mockRejectedValue(
			new ApiError({
				status: 422,
				kind: "invalid_request",
				message: "Nome de canal: de 1 a 32 letras, números, - ou _.",
			}),
		);
		const user = userEvent.setup();
		renderDialogs();
		act(() => openChannelDialog({ kind: "createChannel", categoryId: null }));

		await user.type(await screen.findByLabelText("Nome"), "com!");
		await user.click(screen.getByRole("button", { name: "Criar canal" }));

		expect(
			await screen.findByText(
				"Nome de canal: de 1 a 32 letras, números, - ou _.",
			),
		).toBeInTheDocument();
		expect(useChannelDialog.getState().dialog).not.toBeNull();
	});
});

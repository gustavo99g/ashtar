import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import {
	approveSound,
	deleteSound,
	getMe,
	listMySounds,
	listPendingSounds,
	type MeResponse,
	rejectSound,
	type Sound,
} from "@/lib/api";
import { SoundSettings } from "../components/SoundSettings";
import { when } from "../components/SoundLists";
import { setPendingSounds, setSounds } from "../stores/soundsStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getMe: vi.fn(),
	listMySounds: vi.fn(),
	listPendingSounds: vi.fn(),
	approveSound: vi.fn(),
	rejectSound: vi.fn(),
	deleteSound: vi.fn(),
	fetchFile: vi.fn(() => new Promise(() => {})),
}));

const me = (approve: boolean): MeResponse => ({
	user: { id: "u1", nick: "kid", display_name: null, is_owner: false },
	permissions: [],
	update_channel: "stable",
	status: "available",
	can_create_invite: false,
	can_view_panel: false,
	can_manage_channels: false,
	can_move_members: false,
	can_manage_emojis: false,
	can_view_logs: false,
	can_moderate_voice: false,
	can_send_sounds: true,
	can_approve_sounds: approve,
	can_stream_from_device: false,
});

const sound = (patch: Partial<Sound>): Sound => ({
	id: "s1",
	name: "Uau",
	emoji: "😮",
	file_id: "f1",
	duration_ms: 2400,
	uploaded_by: "u2",
	uploader_name: "juju",
	status: "pending",
	reason: null,
	created_at: 1,
	reviewed_at: null,
	...patch,
});

function renderSettings() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<SoundSettings />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	useSessionStore.setState({
		session: {
			status: "connected",
			user: { id: "u1", nick: "kid", display_name: null, is_owner: false },
		},
	});
	setSounds([sound({ id: "a1", name: "Aplausos", status: "approved" })]);
	setPendingSounds(1);
	vi.mocked(listMySounds).mockResolvedValue([
		sound({ id: "m1", name: "Buzina alta", status: "rejected", reason: "muito alto" }),
		sound({ id: "m2", name: "Grilo", status: "pending" }),
	]);
	vi.mocked(listPendingSounds).mockResolvedValue([sound({})]);
});

describe("Configurações › Servidor › Sons", () => {
	it("quem só envia vê os próprios sons, sem as abas de quem aprova", async () => {
		vi.mocked(getMe).mockResolvedValue(me(false));
		const user = userEvent.setup();
		renderSettings();
		const list = await screen.findByRole("list", { name: "Enviados por você" });
		expect(within(list).getByText('Recusado: "muito alto"')).toBeInTheDocument();
		expect(screen.getByText("1 de 3 aguardando")).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: /Aprovação/ })).not.toBeInTheDocument();
		vi.mocked(deleteSound).mockResolvedValue();
		await user.click(screen.getByRole("button", { name: "Cancelar Grilo" }));
		expect(deleteSound).toHaveBeenCalledWith("m2");
	});

	it("quem aprova tem a fila com o contador, e recusa com o motivo", async () => {
		vi.mocked(getMe).mockResolvedValue(me(true));
		vi.mocked(rejectSound).mockResolvedValue(sound({ status: "rejected" }));
		vi.mocked(approveSound).mockResolvedValue(sound({ status: "approved" }));
		const user = userEvent.setup();
		renderSettings();
		const queue = await screen.findByRole("tab", { name: /Aprovação/ });
		expect(queue).toHaveTextContent("1");
		await user.click(queue);
		const card = await screen.findByRole("list", { name: "Aguardando aprovação" });
		expect(within(card).getByText("juju")).toBeInTheDocument();
		await user.click(within(card).getByRole("button", { name: "Recusar" }));
		await user.type(
			screen.getByRole("textbox", { name: "Motivo da recusa" }),
			"corta o silêncio",
		);
		await user.click(screen.getByRole("button", { name: "Recusar som" }));
		expect(rejectSound).toHaveBeenCalledWith("s1", "corta o silêncio");
		await user.click(screen.getByRole("button", { name: "Voltar" }));
		await user.click(screen.getByRole("button", { name: "Aprovar" }));
		expect(approveSound).toHaveBeenCalledWith("s1");
	});

	it("Todos os sons lista os aprovados, e excluir pergunta antes", async () => {
		vi.mocked(getMe).mockResolvedValue(me(true));
		vi.mocked(deleteSound).mockResolvedValue();
		const user = userEvent.setup();
		renderSettings();
		await user.click(await screen.findByRole("tab", { name: /Todos os sons/ }));
		expect(screen.getByText("1 de 50")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Excluir Aplausos" }));
		await user.click(await screen.findByRole("button", { name: "Excluir" }));
		expect(deleteSound).toHaveBeenCalledWith("a1");
	});

	it("arrastar um arquivo por cima da tela mostra onde soltar", async () => {
		vi.mocked(getMe).mockResolvedValue(me(false));
		renderSettings();
		await screen.findByRole("list", { name: "Enviados por você" });
		fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
		expect(await screen.findByText("Solte para carregar o som")).toBeInTheDocument();
		fireEvent.dragLeave(window, { dataTransfer: { types: ["Files"] } });
		expect(screen.queryByText("Solte para carregar o som")).not.toBeInTheDocument();
	});

	it("as datas: hoje com a hora, antes com o dia", () => {
		const now = new Date(2026, 10, 24, 22, 0).getTime();
		expect(when(new Date(2026, 10, 24, 21, 5).getTime() / 1000, now)).toBe(
			"hoje, 21:05",
		);
		expect(when(new Date(2026, 10, 18, 9, 0).getTime() / 1000, now)).toBe("18/11");
	});
});

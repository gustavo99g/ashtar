import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import {
	createEmoji,
	deleteEmoji,
	type Emoji,
	fetchFile,
	renameEmoji,
	uploadFile,
} from "@/lib/api";
import { EmojiSettings } from "../components/EmojiSettings";
import {
	containBox,
	emojiFileProblem,
	emojiNameProblem,
	nameFromFile,
} from "../model/emojiImage";
import { handleEmojisRealtime } from "../realtime";
import { setEmojis, useEmojiStore } from "../stores/emojiStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createEmoji: vi.fn(),
	deleteEmoji: vi.fn(),
	fetchFile: vi.fn(),
	renameEmoji: vi.fn(),
	uploadFile: vi.fn(),
}));

const kekw: Emoji = {
	id: "e1",
	name: "kekw",
	file_id: "f1",
	animated: false,
	created_by: "u1",
	created_at: 1,
};

function renderSettings() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<EmojiSettings />
		</QueryClientProvider>,
	);
	return client;
}

beforeEach(() => {
	useSessionStore.setState({
		session: {
			status: "connected",
			user: { id: "u1", nick: "kid", display_name: null, is_owner: true },
		},
	});
	vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"]));
	URL.createObjectURL = vi.fn(() => "blob:emoji");
	URL.revokeObjectURL = vi.fn();
	setEmojis([kekw]);
});

afterEach(() => setEmojis([]));

describe("o arquivo e o nome", () => {
	it("aceita PNG, JPEG, WebP e GIF até 256 KB", () => {
		const file = (type: string, size: number) =>
			new File([new Uint8Array(size)], "x", { type });
		expect(emojiFileProblem(file("image/png", 5_000_000))).toBeNull();
		expect(emojiFileProblem(file("image/gif", 200 * 1024))).toBeNull();
		expect(emojiFileProblem(file("image/gif", 300 * 1024))).toBe(
			"O GIF pode ter até 256 KB.",
		);
		expect(emojiFileProblem(file("image/svg+xml", 10))).not.toBeNull();
	});

	it("o nome sai do arquivo e segue a regra", () => {
		expect(nameFromFile("Kekw Feliz.png")).toBe("kekw_feliz");
		expect(nameFromFile("Ação!.gif")).toBe("acao");
		expect(emojiNameProblem("ok")).toBeNull();
		expect(emojiNameProblem("a")).not.toBeNull();
		expect(emojiNameProblem("Maiuscula")).not.toBeNull();
	});

	it("a imagem cabe inteira no quadrado, centrada", () => {
		expect(containBox(256, 128)).toEqual({ x: 0, y: 32, width: 128, height: 64 });
	});
});

describe("Painel › Emojis", () => {
	it("envia um GIF com o nome e mostra a lista", async () => {
		const user = userEvent.setup();
		vi.mocked(uploadFile).mockResolvedValue({ id: "f2" } as never);
		vi.mocked(createEmoji).mockResolvedValue({ ...kekw, id: "e2", name: "dance" });
		renderSettings();
		expect(screen.getByText(":kekw:")).toBeInTheDocument();
		expect(screen.getByText(/1 de 100/)).toBeInTheDocument();
		await user.upload(
			screen.getByLabelText("Escolher a imagem do emoji"),
			new File(["GIF89a"], "Dance.gif", { type: "image/gif" }),
		);
		const name = screen.getByRole("textbox", { name: /Nome/ });
		expect(name).toHaveValue("dance");
		await user.click(screen.getByRole("button", { name: "Salvar" }));
		await vi.waitFor(() =>
			expect(createEmoji).toHaveBeenCalledWith({ name: "dance", file_id: "f2" }),
		);
		expect(vi.mocked(uploadFile).mock.calls[0][1]).toMatchObject({ kind: "emoji" });
		await vi.waitFor(() =>
			expect(screen.queryByRole("form", { name: "Novo emoji" })).not.toBeInTheDocument(),
		);
	});

	it("renomeia e exclui (com a confirmação)", async () => {
		const user = userEvent.setup();
		vi.mocked(renameEmoji).mockResolvedValue();
		vi.mocked(deleteEmoji).mockResolvedValue();
		renderSettings();
		await user.click(screen.getByRole("button", { name: "Renomear" }));
		const field = screen.getByRole("textbox", { name: "Nome novo" });
		await user.clear(field);
		await user.type(field, "rindo{Enter}");
		await vi.waitFor(() => expect(renameEmoji).toHaveBeenCalledWith("e1", "rindo"));
		await user.click(screen.getByRole("button", { name: "Excluir :kekw:" }));
		expect(screen.getByText("As reações com ele também saem.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Excluir" }));
		await vi.waitFor(() => expect(deleteEmoji).toHaveBeenCalledWith("e1"));
	});

	it("o emojis.changed troca a lista", () => {
		const client = new QueryClient();
		handleEmojisRealtime({ type: "emojis.changed", emojis: [] }, client);
		expect(useEmojiStore.getState().emojis).toEqual([]);
	});
});

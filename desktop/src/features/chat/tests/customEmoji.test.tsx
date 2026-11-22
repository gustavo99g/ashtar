import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEmojis } from "@/features/emojis";
import { type Emoji, fetchFile, type Message } from "@/lib/api";
import { Composer } from "../components/Composer";
import { MessageBody } from "../components/MessageBody";
import { Reactions } from "../components/Reactions";
import type { MessageActionsValue } from "../components/messageContext";
import {
	applyEmoji,
	emojiOptions,
	emojiParts,
	emojiQuery,
	onlyCustomEmojis,
} from "../model/customEmoji";
import { setDraft } from "../stores/draftStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
}));
vi.mock("@/lib/tauri/opener", () => ({ openLink: vi.fn() }));

function emoji(id: string, name: string): Emoji {
	return {
		id,
		name,
		file_id: `f-${id}`,
		animated: false,
		created_by: "u1",
		created_at: 1,
	};
}

const kekw = emoji("e1", "kekw");
const gg = emoji("e2", "gg_ez");

beforeEach(() => {
	vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"]));
	URL.createObjectURL = vi.fn(() => "blob:emoji");
	setEmojis([gg, kekw]);
});

afterEach(() => setEmojis([]));

describe("o :nome: no texto", () => {
	it("separa os emojis que existem; o que não existe fica texto", () => {
		const byName = new Map([["kekw", kekw]]);
		expect(emojiParts("rindo :kekw: e :nada:", byName)).toEqual([
			{ kind: "text", text: "rindo " },
			{ kind: "emoji", emoji: kekw },
			{ kind: "text", text: " e :nada:" },
		]);
		expect(onlyCustomEmojis(" :kekw::kekw: ", byName)).toBe(true);
		expect(onlyCustomEmojis(":kekw: oi", byName)).toBe(false);
		expect(onlyCustomEmojis(":nada:", byName)).toBe(false);
	});

	it("a mensagem mostra a imagem, maior quando é só emoji", async () => {
		const { unmount } = render(<MessageBody body="rindo :kekw: muito" />);
		const image = await screen.findByRole("img", { name: ":kekw:" });
		expect(image).toHaveAttribute("title", ":kekw:");
		expect(image).not.toHaveClass("size-12");
		expect(screen.getByText(/rindo/)).toHaveTextContent("rindo muito");
		unmount();
		render(<MessageBody body=":kekw:" />);
		expect(await screen.findByRole("img", { name: ":kekw:" })).toHaveClass(
			"size-12",
		);
	});
});

describe("as sugestões ao digitar :", () => {
	it("acha o :nom antes do cursor e completa", () => {
		expect(emojiQuery("oi :ke", 6)).toEqual({ start: 3, query: "ke" });
		expect(emojiQuery("12:30", 5)).toBeNull();
		expect(emojiOptions([gg, kekw, emoji("e3", "ok_kek")], "kek").map((e) => e.name)).toEqual([
			"kekw",
			"ok_kek",
		]);
		expect(applyEmoji("oi :ke fim", 3, 6, "kekw")).toEqual({
			text: "oi :kekw:  fim",
			caret: 10,
		});
	});

	it("o campo mostra a lista e o Enter escolhe sem mandar", async () => {
		const user = userEvent.setup();
		setDraft("geral", "");
		const onSend = vi.fn();
		render(
			<Composer
				channelId="geral"
				label="Mensagem para #geral"
				myId="kid"
				onSend={onSend}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Mensagem para #geral" });
		await user.type(field, "boa :ke");
		expect(
			screen.getByRole("listbox", { name: "Emojis do grupo" }),
		).toHaveTextContent(":kekw:");
		await user.keyboard("{Enter}");
		expect(field).toHaveValue("boa :kekw: ");
		expect(onSend).not.toHaveBeenCalled();
	});
});

describe("a reação com emoji do grupo", () => {
	const message = {
		id: "m1",
		reactions: [
			{ emoji: "c:e1", users: ["u2"] },
			{ emoji: "c:apagado", users: ["u2"] },
			{ emoji: "👍", users: ["u2"] },
		],
	} as unknown as Message;
	const actions = {
		myId: "u1",
		people: new Map(),
		react: vi.fn(),
	} as unknown as MessageActionsValue;

	it("mostra a imagem com o nome, e a de um emoji excluído some", async () => {
		render(<Reactions message={message} actions={actions} />);
		expect(
			screen.getByRole("button", { name: "Reação :kekw:, 1 pessoa" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Reação 👍, 1 pessoa" })).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: /^Reação/ })).toHaveLength(2);
	});
});

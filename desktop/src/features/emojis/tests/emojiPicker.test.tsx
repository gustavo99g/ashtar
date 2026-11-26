import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Emoji, fetchFile } from "@/lib/api";
import { EmojiPicker } from "../components/EmojiPicker";
import { setEmojis } from "../stores/emojiStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
}));

const kekw: Emoji = {
	id: "e1",
	name: "kekw",
	file_id: "f-e1",
	animated: false,
	created_by: "u1",
	created_at: 1,
};

beforeEach(() => {
	vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"]));
	URL.createObjectURL = vi.fn(() => "blob:emoji");
	setEmojis([kekw]);
});

afterEach(() => setEmojis([]));

describe("o seletor de emoji", () => {
	it("mostra os emojis do grupo", async () => {
		render(<EmojiPicker onPick={() => {}} />);
		expect(await screen.findByText("Do grupo")).toBeInTheDocument();
	});

});

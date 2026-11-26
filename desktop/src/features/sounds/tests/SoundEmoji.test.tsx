import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEmojis } from "@/features/emojis";
import { fetchFile } from "@/lib/api";
import { SoundEmoji } from "../components/SoundEmoji";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
}));

beforeEach(() => {
	vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"]));
	URL.createObjectURL = vi.fn(() => "blob:emoji");
	setEmojis([
		{
			id: "e1",
			name: "kekw",
			file_id: "f-e1",
			animated: false,
			created_by: "u1",
			created_at: 1,
		},
	]);
});

afterEach(() => setEmojis([]));

describe("o emoji do som", () => {
	it("um comum é o texto, e sem emoji fica o 🔊", () => {
		const { rerender } = render(<SoundEmoji emoji="😮" />);
		expect(screen.getByText("😮")).toBeInTheDocument();
		rerender(<SoundEmoji emoji={null} />);
		expect(screen.getByText("🔊")).toBeInTheDocument();
	});

	it("um do grupo é a imagem, e um que foi excluído vira o 🔊", async () => {
		const { rerender } = render(<SoundEmoji emoji="c:e1" />);
		expect(await screen.findByAltText(":kekw:")).toBeInTheDocument();
		rerender(<SoundEmoji emoji="c:sumiu" />);
		expect(screen.getByText("🔊")).toBeInTheDocument();
	});
});

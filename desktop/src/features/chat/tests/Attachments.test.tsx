import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFile, type FileView } from "@/lib/api";
import { clearFileCache } from "@/lib/fileCache";
import { downloadFile } from "@/lib/tauri/commands";
import { Attachments } from "../components/Attachments";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
}));
vi.mock("@/lib/tauri/commands", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri/commands")>()),
	downloadFile: vi.fn(),
}));

function file(overrides: Partial<FileView>): FileView {
	return {
		id: "f1",
		kind: "attachment",
		name: "foto.png",
		mime: "image/png",
		size: 2048,
		width: 800,
		height: 600,
		duration_ms: null,
		thumbnail_id: "t1",
		...overrides,
	};
}

beforeEach(() => {
	clearFileCache();
	URL.createObjectURL = vi.fn(() => "blob:x");
	URL.revokeObjectURL = vi.fn();
	vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"]));
	vi.mocked(downloadFile).mockReset();
});

describe("os anexos na mensagem", () => {
	it("a imagem ocupa o espaço reservado e abre o visualizador com o original", async () => {
		const user = userEvent.setup();
		render(<Attachments files={[file({})]} />);
		const open = screen.getByRole("button", { name: "Abrir foto.png" });
		expect(open).toHaveStyle({ width: "400px" });
		await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledWith("t1"));

		await user.click(open);
		expect(
			await screen.findByRole("dialog", { name: "foto.png" }),
		).toBeInTheDocument();
		await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledWith("f1"));
	});

	it("o resto é o cartão com o tipo, o tamanho e Baixar", async () => {
		const user = userEvent.setup();
		vi.mocked(downloadFile).mockResolvedValue("C:/Downloads/notas.pdf");
		render(
			<Attachments
				files={[
					file({
						id: "f2",
						name: "notas.pdf",
						mime: "application/pdf",
						thumbnail_id: null,
					}),
				]}
			/>,
		);
		expect(screen.getByText("PDF · 2 KB")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Baixar notas.pdf" }));
		expect(downloadFile).toHaveBeenCalledWith(
			"f2",
			"notas.pdf",
			expect.any(Function),
		);
	});
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFile, type FileView, fileLink } from "@/lib/api";
import { clearFileCache } from "@/lib/fileCache";
import { downloadFile } from "@/lib/tauri/commands";
import { Attachments } from "../components/Attachments";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
	fileLink: vi.fn(),
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

	it("o vídeo mostra a capa e a duração; o play toca ali, um de cada vez", async () => {
		const user = userEvent.setup();
		vi.mocked(fileLink).mockImplementation(async (id) => ({
			path: `/api/files/${id}/stream?exp=1&sig=x`,
			expires_at: 1,
		}));
		const video = (id: string) =>
			file({
				id,
				name: `${id}.mp4`,
				mime: "video/mp4",
				thumbnail_id: `capa-${id}`,
				duration_ms: 83_000,
			});
		const { container } = render(
			<Attachments files={[video("v1"), video("v2")]} />,
		);
		expect(screen.getAllByText("1:23")).toHaveLength(2);
		await user.click(screen.getByRole("button", { name: "Tocar v1.mp4" }));
		await vi.waitFor(() =>
			expect(container.querySelector("video")?.getAttribute("src")).toMatch(
				/\/api\/files\/v1\/stream\?exp=1&sig=x$/,
			),
		);
		expect(container.querySelector("video")?.muted).toBe(true);

		await user.click(screen.getByRole("button", { name: "Tocar v2.mp4" }));
		await vi.waitFor(() =>
			expect(container.querySelector("video")?.getAttribute("src")).toMatch(
				/v2\/stream/,
			),
		);
		expect(container.querySelectorAll("video")).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: "Tocar v1.mp4" }),
		).toBeInTheDocument();
	});
});

import { describe, expect, it } from "vitest";
import {
	ATTACHMENT_MAX_BYTES,
	attachProblem,
	fileCaption,
	fitBox,
} from "../model/attachments";

describe("os anexos", () => {
	it("a imagem cabe na caixa de 400×300 sem aumentar", () => {
		expect(fitBox(800, 600)).toEqual({ width: 400, height: 300 });
		expect(fitBox(1000, 200)).toEqual({ width: 400, height: 80 });
		expect(fitBox(120, 90)).toEqual({ width: 120, height: 90 });
		expect(fitBox(null, null)).toEqual({ width: 400, height: 300 });
	});

	it("o cartão diz o tipo e o tamanho", () => {
		expect(fileCaption("video/mp4", "a.mp4", 48 * 1024 * 1024)).toBe(
			"vídeo · 48 MB",
		);
		expect(fileCaption("application/pdf", "a.pdf", 1536)).toBe("PDF · 1,5 KB");
		expect(fileCaption("application/zip", "fotos.zip", 10)).toBe("ZIP · 10 B");
		expect(fileCaption("application/octet-stream", "LEIAME", 10)).toBe(
			"arquivo · 10 B",
		);
	});

	it("até 10 arquivos, de até 100 MB", () => {
		const small = { name: "a.png", size: 10 };
		expect(attachProblem(9, [small])).toBeNull();
		expect(attachProblem(9, [small, small])).toBe(
			"Uma mensagem leva até 10 arquivos.",
		);
		expect(
			attachProblem(0, [{ name: "filme.mp4", size: ATTACHMENT_MAX_BYTES + 1 }]),
		).toBe("filme.mp4 passa de 100 MB.");
	});
});

describe("a duração do vídeo", () => {
	it("em minutos e segundos, e com horas quando passa de uma", async () => {
		const { durationLabel } = await import("../model/attachments");
		expect(durationLabel(42_000)).toBe("0:42");
		expect(durationLabel(725_400)).toBe("12:05");
		expect(durationLabel(3_723_000)).toBe("1:02:03");
	});
});

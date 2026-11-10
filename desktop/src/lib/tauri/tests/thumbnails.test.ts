import { describe, expect, it } from "vitest";
import { parseThumbnail } from "../commands/thumbnails";

describe("parseThumbnail", () => {
	it("lê o tipo e o id na frente, e o resto é o JPEG", () => {
		// O mesmo do teste `a_mensagem_leva_o_tipo_e_o_id_na_frente` do Rust.
		const message = new Uint8Array([1, 2, 1, 0, 0, 0, 0, 0, 0, 9, 9]).buffer;
		const thumbnail = parseThumbnail(message);
		expect(thumbnail?.source).toEqual({ kind: "monitor", id: 0x0102 });
		expect([...(thumbnail?.jpeg ?? [])]).toEqual([9, 9]);
	});

	it("janela é o tipo 0, e uma mensagem curta é ignorada", () => {
		const message = new Uint8Array([0, 7, 0, 0, 0, 0, 0, 0, 0]).buffer;
		expect(parseThumbnail(message)?.source).toEqual({ kind: "window", id: 7 });
		expect(parseThumbnail(new Uint8Array([0, 1]).buffer)).toBeNull();
	});
});

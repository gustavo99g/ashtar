import { describe, expect, it } from "vitest";
import { keyInput, mouseInput } from "./windowInput";

describe("as teclas da janela no formato do gancho", () => {
	it("os modificadores ganham o lado, e as outras teclas ficam como vêm", () => {
		expect(keyInput({ keyCode: 17, location: 1 })).toEqual({ key: 0xa2, mouse: null });
		expect(keyInput({ keyCode: 17, location: 2 })).toEqual({ key: 0xa3, mouse: null });
		expect(keyInput({ keyCode: 16, location: 1 })).toEqual({ key: 0xa0, mouse: null });
		expect(keyInput({ keyCode: 18, location: 2 })).toEqual({ key: 0xa5, mouse: null });
		expect(keyInput({ keyCode: 77, location: 0 })).toEqual({ key: 77, mouse: null });
		expect(keyInput({ keyCode: 0, location: 0 })).toBeNull();
	});

	it("só o botão do meio e os laterais do mouse", () => {
		expect(mouseInput(0)).toBeNull();
		expect(mouseInput(2)).toBeNull();
		expect(mouseInput(1)).toEqual({ key: null, mouse: "middle" });
		expect(mouseInput(3)).toEqual({ key: null, mouse: "x1" });
		expect(mouseInput(4)).toEqual({ key: null, mouse: "x2" });
	});
});

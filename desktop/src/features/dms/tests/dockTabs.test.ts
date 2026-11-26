import { describe, expect, it } from "vitest";
import { dockTabs } from "../components/DmDock";

describe("dockTabs", () => {
	it("sem a largura medida, vale o máximo de três com a expandida", () => {
		expect(dockTabs(null, true, 5)).toBe(2);
		expect(dockTabs(null, false, 5)).toBe(3);
		expect(dockTabs(null, true, 1)).toBe(1);
	});

	it("com espaço, a expandida e duas abas", () => {
		expect(dockTabs(1200, true, 2)).toBe(2);
	});

	it("numa área estreita, as abas que não cabem vão para o +N", () => {
		// 900 px: a janela de 440 e uma aba de 210, com o "+1" ao lado.
		expect(dockTabs(900, true, 2)).toBe(1);
		// Sem espaço para nenhuma aba, tudo fica no "+N".
		expect(dockTabs(560, true, 2)).toBe(0);
	});
});

import { beforeEach, describe, expect, it } from "vitest";
import {
	focusCamera,
	focusShare,
	stopWatching,
	useRoomView,
	watchShare,
} from "../stores/roomViewStore";

describe("a câmera em foco", () => {
	beforeEach(() => stopWatching());

	it("clicar de novo na mesma tira do foco", () => {
		focusCamera("ana");
		expect(useRoomView.getState().focusedCamera).toBe("ana");
		focusCamera("ana");
		expect(useRoomView.getState().focusedCamera).toBeNull();
	});

	it("uma transmissão escolhida toma o lugar da câmera", () => {
		watchShare("bia");
		watchShare("caio");
		focusShare("bia");
		focusCamera("ana");
		// "bia" já estava em foco: com a câmera no palco, escolher de novo volta para ela.
		focusShare("bia");
		const state = useRoomView.getState();
		expect(state.focusedCamera).toBeNull();
		expect(state.focused).toBe("bia");
	});

	it("voltar para a Grade tira a câmera do foco", () => {
		focusCamera("ana");
		stopWatching();
		expect(useRoomView.getState().focusedCamera).toBeNull();
	});
});

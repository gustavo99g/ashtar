import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	canPlay,
	chosenOutput,
	playSound,
	resetSoundGap,
	SOUND_GAP_MS,
} from "../model/sound";

describe("os sons", () => {
	const play = vi.fn(() => Promise.resolve());

	beforeEach(() => {
		localStorage.clear();
		resetSoundGap();
		play.mockClear();
		vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(play);
	});

	afterEach(() => vi.restoreAllMocks());

	it(`toca no máximo um a cada ${SOUND_GAP_MS / 1000} s`, () => {
		expect(canPlay(null, 0)).toBe(true);
		expect(canPlay(1000, 1000 + SOUND_GAP_MS - 1)).toBe(false);
		expect(canPlay(1000, 1000 + SOUND_GAP_MS)).toBe(true);
	});

	it("uma rajada vira um som só", async () => {
		playSound("dm", 10_000);
		playSound("mention", 10_500);
		playSound("dm", 10_000 + SOUND_GAP_MS);
		await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
	});

	it("lê a saída escolhida em Voz e vídeo", () => {
		expect(chosenOutput()).toBeNull();
		localStorage.setItem(
			"ashtar-devices",
			JSON.stringify({ state: { input: null, output: { id: "fone", label: "Fone" } }, version: 1 }),
		);
		expect(chosenOutput()).toBe("fone");
		localStorage.setItem("ashtar-devices", "{quebrado");
		expect(chosenOutput()).toBeNull();
	});
});

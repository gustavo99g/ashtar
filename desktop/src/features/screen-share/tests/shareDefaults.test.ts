import { describe, expect, it } from "vitest";
import {
	DEFAULT_SHARE,
	initialShareAudio,
	readShareDefaults,
} from "../stores/shareDefaultsStore";

describe("o padrão do compartilhamento de tela", () => {
	it("sem nada guardado, Movimento e só o aplicativo", () => {
		expect(readShareDefaults(undefined)).toEqual(DEFAULT_SHARE);
		expect(DEFAULT_SHARE).toEqual({
			quality: "1080p60",
			audio: "application",
			hardwareEncoder: true,
		});
	});

	it("um valor que saiu do app volta para o padrão", () => {
		expect(readShareDefaults({ quality: "4k", audio: "tudo" })).toEqual(
			DEFAULT_SHARE,
		);
		expect(
			readShareDefaults({
				quality: "1080p30",
				audio: "off",
				hardwareEncoder: false,
			}),
		).toEqual({
			quality: "1080p30",
			audio: "off",
			hardwareEncoder: false,
		});
		expect(readShareDefaults({ hardwareEncoder: "sim" }).hardwareEncoder).toBe(
			true,
		);
	});

	it("uma tela inteira não tem aplicativo: o padrão vira todo o sistema", () => {
		expect(initialShareAudio("application", "windows")).toBe("application");
		expect(initialShareAudio("application", "screens")).toBe("system");
		expect(initialShareAudio("off", "screens")).toBe("off");
	});
});

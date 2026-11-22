import { beforeEach, describe, expect, it } from "vitest";
import {
	audibleVolume,
	setShareQuality,
	setShareVolume,
	shareSettingsOf,
	toggleShareMuted,
	useShareVolume,
} from "../stores/shareVolumeStore";

const volume = (owner = "juju") =>
	audibleVolume(useShareVolume.getState(), owner);

describe("volume de cada transmissão", () => {
	beforeEach(() => {
		localStorage.clear();
		useShareVolume.setState({
			byOwner: {},
			fallback: { volume: 100, muted: false },
		});
	});

	it("o ícone tira o som e volta ao volume de antes", () => {
		setShareVolume("juju", 40);
		toggleShareMuted("juju");
		expect(volume()).toBe(0);
		toggleShareMuted("juju");
		expect(volume()).toBe(40);
	});

	it("arrastar até o zero tira o som sem perder o volume de antes", () => {
		setShareVolume("juju", 30);
		setShareVolume("juju", 0);
		expect(volume()).toBe(0);
		toggleShareMuted("juju");
		expect(volume()).toBe(30);
		toggleShareMuted("juju");
		setShareVolume("juju", 55);
		expect(volume()).toBe(55);
	});

	it("cada transmissão tem o seu volume", () => {
		setShareVolume("juju", 50);
		setShareVolume("marcao", 150);
		toggleShareMuted("rafa");
		expect(volume("juju")).toBe(50);
		expect(volume("marcao")).toBe(150);
		expect(volume("rafa")).toBe(0);
	});

	it("quem ainda não tem ajuste começa no último volume escolhido, com som", () => {
		setShareVolume("juju", 70);
		toggleShareMuted("juju");
		expect(volume("novo")).toBe(70);
	});

	it("a qualidade é por transmissão e não mexe no volume", () => {
		setShareVolume("juju", 80);
		setShareQuality("juju", "lite");
		const juju = shareSettingsOf(useShareVolume.getState(), "juju");
		expect(juju).toEqual({ volume: 80, muted: false, quality: "lite" });
		expect(shareSettingsOf(useShareVolume.getState(), "marcao").quality).toBe(
			"auto",
		);
	});

	it("vai até 200%", () => {
		setShareVolume("juju", 180);
		expect(volume()).toBe(180);
		setShareVolume("juju", 350);
		expect(volume()).toBe(200);
	});

	it("fica gravado para a próxima abertura", async () => {
		setShareVolume("juju", 25);
		localStorage.setItem(
			"ashtar-share-volume",
			JSON.stringify({
				state: {
					byOwner: { juju: { volume: 60, muted: true, quality: "lite" } },
					fallback: { volume: 90, muted: false },
				},
				version: 2,
			}),
		);
		await useShareVolume.persist.rehydrate();
		expect(volume("juju")).toBe(0);
		toggleShareMuted("juju");
		expect(volume("juju")).toBe(60);
		expect(volume("outro")).toBe(90);
	});

	it("o volume único da 0.3 vira o de quem ainda não tem ajuste", async () => {
		localStorage.setItem(
			"ashtar-share-volume",
			JSON.stringify({ state: { volume: 150, muted: false }, version: 1 }),
		);
		await useShareVolume.persist.rehydrate();
		expect(volume("qualquer")).toBe(150);
	});

	it("um valor estranho no disco volta para o padrão", async () => {
		localStorage.setItem(
			"ashtar-share-volume",
			JSON.stringify({
				state: {
					byOwner: { juju: { volume: 900, muted: "sim" } },
					fallback: { volume: "alto" },
				},
				version: 2,
			}),
		);
		await useShareVolume.persist.rehydrate();
		expect(useShareVolume.getState()).toEqual(
			expect.objectContaining({
				byOwner: {},
				fallback: { volume: 100, muted: false },
			}),
		);
	});
});

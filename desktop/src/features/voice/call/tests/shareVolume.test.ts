import { beforeEach, describe, expect, it } from "vitest";
import {
	audibleVolume,
	setShareVolume,
	toggleShareMuted,
	useShareVolume,
} from "../stores/shareVolumeStore";

const volume = () => audibleVolume(useShareVolume.getState());

describe("volume da transmissão", () => {
	beforeEach(() => {
		localStorage.clear();
		useShareVolume.setState({ volume: 100, muted: false });
	});

	it("o ícone tira o som e volta ao volume de antes", () => {
		setShareVolume(40);
		toggleShareMuted();
		expect(volume()).toBe(0);
		toggleShareMuted();
		expect(volume()).toBe(40);
	});

	it("arrastar até o zero tira o som sem perder o volume de antes", () => {
		setShareVolume(30);
		setShareVolume(0);
		expect(volume()).toBe(0);
		toggleShareMuted();
		expect(volume()).toBe(30);
		// Arrastar de novo liga o som no valor novo.
		toggleShareMuted();
		setShareVolume(55);
		expect(volume()).toBe(55);
	});

	it("fica gravado para a próxima abertura", async () => {
		setShareVolume(25);
		expect(
			JSON.parse(localStorage.getItem("ashtar-share-volume") ?? "{}").state,
		).toEqual({
			volume: 25,
			muted: false,
		});

		// A próxima abertura lê o que ficou no disco.
		localStorage.setItem(
			"ashtar-share-volume",
			JSON.stringify({ state: { volume: 60, muted: true }, version: 1 }),
		);
		await useShareVolume.persist.rehydrate();
		expect(volume()).toBe(0);
		toggleShareMuted();
		expect(volume()).toBe(60);
	});

	it("vai até 200%, para reforçar uma transmissão que chega baixa", async () => {
		setShareVolume(180);
		expect(volume()).toBe(180);
		setShareVolume(350);
		expect(volume()).toBe(200);

		localStorage.setItem(
			"ashtar-share-volume",
			JSON.stringify({ state: { volume: 150, muted: false }, version: 1 }),
		);
		await useShareVolume.persist.rehydrate();
		expect(volume()).toBe(150);
	});

	it("um valor estranho no disco volta para 100%", async () => {
		localStorage.setItem(
			"ashtar-share-volume",
			JSON.stringify({ state: { volume: 900, muted: "sim" }, version: 1 }),
		);
		await useShareVolume.persist.rehydrate();
		expect(useShareVolume.getState()).toMatchObject({
			volume: 100,
			muted: false,
		});
	});
});

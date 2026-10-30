import { beforeEach, describe, expect, it } from "vitest";
import {
	type AudioDevice,
	chooseDevice,
	type DeviceInfo,
	effectiveDevice,
	isMissing,
	knownDevices,
	readDevices,
	UNKNOWN_DEVICES,
	useDeviceChoice,
} from "../devices";

/** O que o WebView2 devolve no Windows: o "default", o "communications" e os de verdade. */
const WINDOWS: DeviceInfo[] = [
	{
		kind: "audioinput",
		deviceId: "default",
		label: "Padrão - Microfone (Headset USB)",
		groupId: "g-usb",
	},
	{
		kind: "audioinput",
		deviceId: "communications",
		label: "Comunicações - Microfone (Realtek)",
		groupId: "g-rt",
	},
	{
		kind: "audioinput",
		deviceId: "mic-rt",
		label: "Microfone (Realtek)",
		groupId: "g-rt",
	},
	{
		kind: "audioinput",
		deviceId: "mic-usb",
		label: "Microfone (Headset USB)",
		groupId: "g-usb",
	},
	{
		kind: "audiooutput",
		deviceId: "default",
		label: "Padrão - Alto-falantes (Realtek)",
		groupId: "g-rt",
	},
	{
		kind: "audiooutput",
		deviceId: "out-rt",
		label: "Alto-falantes (Realtek)",
		groupId: "g-rt",
	},
	{
		kind: "audiooutput",
		deviceId: "out-usb",
		label: "Fones (Headset USB)",
		groupId: "g-usb",
	},
	{ kind: "videoinput", deviceId: "cam", label: "Câmera HD", groupId: "g-cam" },
];

const usb: AudioDevice = { id: "out-usb", label: "Fones (Headset USB)" };
const realtek: AudioDevice = { id: "out-rt", label: "Alto-falantes (Realtek)" };

describe("lista dos dispositivos", () => {
	it("separa entrada e saída, sem o default, o communications e a câmera", () => {
		const devices = readDevices(WINDOWS);

		expect(devices.input.map((device) => device.id)).toEqual([
			"mic-rt",
			"mic-usb",
		]);
		expect(devices.output.map((device) => device.id)).toEqual([
			"out-rt",
			"out-usb",
		]);
		expect(devices.hidden).toBe(false);
	});

	it("acha o nome do padrão do Windows pelo groupId do default", () => {
		expect(readDevices(WINDOWS).defaults).toEqual({
			input: "Microfone (Headset USB)",
			output: "Alto-falantes (Realtek)",
		});
	});

	it("sem a permissão do microfone, a lista avisa que esconde coisas", () => {
		const devices = readDevices([
			{ kind: "audioinput", deviceId: "", label: "", groupId: "" },
			{ kind: "audiooutput", deviceId: "", label: "", groupId: "" },
		]);

		expect(devices.input).toEqual([]);
		expect(devices.hidden).toBe(true);
		expect(knownDevices(devices, "input")).toBeNull();
	});

	it("uma lista que ainda não foi lida também não serve para dizer o que sumiu", () => {
		expect(knownDevices(null, "output")).toBeNull();
		expect(knownDevices(UNKNOWN_DEVICES, "output")).toBeNull();
		expect(knownDevices(readDevices(WINDOWS), "output")).toHaveLength(2);
	});
});

describe("o dispositivo que vale", () => {
	it("sem escolha, vale o padrão do Windows", () => {
		expect(effectiveDevice(null, [usb, realtek])).toBeNull();
		expect(isMissing(null, [usb, realtek])).toBe(false);
	});

	it("o escolhido vale enquanto está conectado", () => {
		expect(effectiveDevice(usb, [realtek, usb])).toBe("out-usb");
		expect(isMissing(usb, [realtek, usb])).toBe(false);
	});

	it("o escolhido some: vale o padrão do Windows; ele volta: vale ele de novo", () => {
		expect(effectiveDevice(usb, [realtek])).toBeNull();
		expect(isMissing(usb, [realtek])).toBe(true);

		expect(effectiveDevice(usb, [realtek, usb])).toBe("out-usb");
		expect(isMissing(usb, [realtek, usb])).toBe(false);
	});

	it("sem uma lista que sirva, confia no escolhido", () => {
		expect(effectiveDevice(usb, null)).toBe("out-usb");
		expect(isMissing(usb, null)).toBe(false);
	});
});

describe("a escolha guardada", () => {
	beforeEach(() => {
		localStorage.clear();
		useDeviceChoice.setState({ input: null, output: null });
	});

	it("fica gravada para a próxima abertura, com o nome", async () => {
		chooseDevice("output", usb);
		const saved = localStorage.getItem("ashtar-devices") ?? "{}";
		expect(JSON.parse(saved).state).toEqual({ input: null, output: usb });

		// A próxima abertura lê o que ficou no disco.
		useDeviceChoice.setState({ input: null, output: null });
		localStorage.setItem("ashtar-devices", saved);
		await useDeviceChoice.persist.rehydrate();

		expect(useDeviceChoice.getState()).toMatchObject({
			input: null,
			output: usb,
		});
	});

	it("voltar ao padrão do Windows apaga só aquele tipo", () => {
		chooseDevice("input", { id: "mic-usb", label: "Microfone (Headset USB)" });
		chooseDevice("output", usb);

		chooseDevice("input", null);

		expect(useDeviceChoice.getState()).toMatchObject({
			input: null,
			output: usb,
		});
	});

	it("um valor estranho no disco volta para o padrão do Windows", async () => {
		localStorage.setItem(
			"ashtar-devices",
			JSON.stringify({
				state: { input: { id: "" }, output: "out-usb" },
				version: 1,
			}),
		);

		await useDeviceChoice.persist.rehydrate();

		expect(useDeviceChoice.getState()).toMatchObject({
			input: null,
			output: null,
		});
	});
});

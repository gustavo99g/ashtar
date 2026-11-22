import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_INPUT, useInputChoice } from "../../input/stores/inputStore";
import { VoiceSettings } from "../components/VoiceSettings";
import type { DeviceInfo } from "../model/devices";
import { chooseDevice, useDeviceChoice } from "../stores/deviceChoiceStore";

// A câmera tem os próprios testes; aqui, só o áudio.
vi.mock("../../camera/components/CameraOptions", () => ({
	CameraOptions: () => null,
}));

const WINDOWS: DeviceInfo[] = [
	{
		kind: "audioinput",
		deviceId: "default",
		label: "Padrão - Microfone (Realtek)",
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
];
const FONE_BT: DeviceInfo = {
	kind: "audiooutput",
	deviceId: "fone-bt",
	label: "Fones de ouvido (Fone Bluetooth)",
	groupId: "g-bt",
};

let windowsDevices: DeviceInfo[] = [];
const mediaDevices = Object.assign(new EventTarget(), {
	enumerateDevices: vi.fn(async () => windowsDevices),
	getUserMedia: vi.fn(),
});

function plug(next: DeviceInfo[]) {
	windowsDevices = next;
	act(() => {
		mediaDevices.dispatchEvent(new Event("devicechange"));
	});
}

beforeEach(() => {
	windowsDevices = WINDOWS;
	Object.defineProperty(navigator, "mediaDevices", {
		value: mediaDevices,
		configurable: true,
	});
	localStorage.clear();
	useDeviceChoice.setState({ input: null, output: null });
	useInputChoice.setState(DEFAULT_INPUT);
});

afterEach(() => {
	Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("Voz e vídeo", () => {
	it("começa no padrão do Windows, dizendo qual dispositivo ele é agora", async () => {
		render(<VoiceSettings />);

		const input = screen.getByRole("combobox", { name: "Entrada" });
		await waitFor(() =>
			expect(input).toHaveTextContent(
				"Padrão do Windows · Microfone (Realtek)",
			),
		);
		expect(screen.getByRole("combobox", { name: "Saída" })).toHaveTextContent(
			"Padrão do Windows · Alto-falantes (Realtek)",
		);
	});

	it("escolher um microfone guarda a escolha; voltar ao padrão também", async () => {
		const user = userEvent.setup();
		render(<VoiceSettings />);
		const input = screen.getByRole("combobox", { name: "Entrada" });
		await waitFor(() => expect(input).toHaveTextContent("Microfone (Realtek)"));

		await user.click(input);
		await user.click(
			await screen.findByRole("option", { name: "Microfone (Headset USB)" }),
		);

		expect(useDeviceChoice.getState().input).toEqual({
			id: "mic-usb",
			label: "Microfone (Headset USB)",
		});
		expect(input).toHaveTextContent("Microfone (Headset USB)");

		await user.click(input);
		await user.click(
			await screen.findByRole("option", { name: /^Padrão do Windows/ }),
		);

		expect(useDeviceChoice.getState().input).toBeNull();
	});

	it("a supressão de ruído começa ligada; desligar guarda neste computador", async () => {
		const user = userEvent.setup();
		render(<VoiceSettings />);

		const toggle = screen.getByRole("switch", { name: "Supressão de ruído" });
		expect(toggle).toBeChecked();
		await user.click(toggle);
		expect(toggle).not.toBeChecked();
		expect(useInputChoice.getState().suppression).toBe(false);
		expect(
			JSON.parse(localStorage.getItem("ashtar-input") ?? "{}"),
		).toMatchObject({
			state: { suppression: false },
		});
	});

	it("o fone escolhido desconectado aparece assim, com o padrão no lugar, até voltar", async () => {
		chooseDevice("output", {
			id: "fone-bt",
			label: "Fones de ouvido (Fone Bluetooth)",
		});
		render(<VoiceSettings />);
		const output = screen.getByRole("combobox", { name: "Saída" });

		await waitFor(() =>
			expect(output).toHaveTextContent(
				"Fones de ouvido (Fone Bluetooth) (desconectado)",
			),
		);
		expect(output).toHaveAccessibleDescription(
			"Desconectado. Até ele voltar, o Ashtar usa o padrão do Windows: Alto-falantes (Realtek).",
		);

		plug([...WINDOWS, FONE_BT]);

		await waitFor(() =>
			expect(output).toHaveTextContent("Fones de ouvido (Fone Bluetooth)"),
		);
		expect(output).not.toHaveTextContent("desconectado");
		expect(screen.queryByText(/Até ele voltar/)).not.toBeInTheDocument();
		// A escolha não mudou: ele só voltou a valer.
		expect(useDeviceChoice.getState().output?.id).toBe("fone-bt");
	});

	it("o desconectado fica na lista, mas não dá para escolher", async () => {
		const user = userEvent.setup();
		chooseDevice("output", {
			id: "fone-bt",
			label: "Fones de ouvido (Fone Bluetooth)",
		});
		render(<VoiceSettings />);
		const output = screen.getByRole("combobox", { name: "Saída" });
		await waitFor(() => expect(output).toHaveTextContent("desconectado"));

		await user.click(output);

		expect(
			await screen.findByRole("option", {
				name: "Fones de ouvido (Fone Bluetooth) (desconectado)",
			}),
		).toHaveAttribute("aria-disabled", "true");
	});
});

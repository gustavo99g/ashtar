/**
 * A escolha do microfone e da saída, guardada neste computador (`localStorage`, como o tema e o
 * volume da transmissão). Vale em toda chamada; as regras estão em `model/devices.ts`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AudioDevice, ChosenDevice, DeviceKind } from "../model/devices";

type DeviceChoice = Record<DeviceKind, ChosenDevice | null>;

const NOTHING_CHOSEN: DeviceChoice = { input: null, output: null };

function readChosen(value: unknown): ChosenDevice | null {
	if (typeof value !== "object" || value === null) return null;
	const { id, label } = value as Partial<ChosenDevice>;
	return typeof id === "string" && id !== "" && typeof label === "string"
		? { id, label }
		: null;
}

/** A escolha deste computador. Fica no `localStorage` do app, fora da API. */
export const useDeviceChoice = create<DeviceChoice>()(
	persist(() => NOTHING_CHOSEN, {
		name: "ashtar-devices",
		version: 1,
		// Um valor estranho no disco volta para o padrão do Windows.
		merge: (persisted, current) => {
			const saved = persisted as
				| Partial<Record<DeviceKind, unknown>>
				| undefined;
			return {
				...current,
				input: readChosen(saved?.input),
				output: readChosen(saved?.output),
			};
		},
	}),
);

/** Escolhe o dispositivo de `kind`; `null` volta para o padrão do Windows. */
export function chooseDevice(
	kind: DeviceKind,
	device: AudioDevice | null,
): void {
	const chosen = device && { id: device.id, label: device.label };
	useDeviceChoice.setState(
		kind === "input" ? { input: chosen } : { output: chosen },
	);
}

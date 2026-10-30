/**
 * Os dispositivos de áudio deste computador e a escolha da pessoa em Configurações › Voz e vídeo:
 * o microfone (entrada) e o fone ou alto-falante (saída).
 *
 * A lista vem do `enumerateDevices` do WebView2 (`useAudioDevices`). A escolha fica no
 * `localStorage` do app, como o tema e o volume da transmissão, e vale em toda chamada: o
 * `VoiceProvider` entra com ela e troca na hora quando ela muda.
 *
 * Nada escolhido (`null`) é o padrão do Windows. Um dispositivo escolhido que sumiu (o fone
 * desligado) continua escolhido: enquanto ele não volta, vale o padrão do Windows
 * (`effectiveDevice`); quando volta, ele volta a valer.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DeviceKind = "input" | "output";

/** Um microfone ou uma saída, como o WebView2 lista. */
export interface AudioDevice {
	/** O id do WebView2. Não muda neste computador enquanto os dados do app não forem apagados. */
	id: string;
	/** O nome que o Windows dá, como "Microfone (Headset USB)". */
	label: string;
}

export interface AudioDevices {
	input: AudioDevice[];
	output: AudioDevice[];
	/** O nome do dispositivo que o Windows usa como padrão agora, quando dá para saber. */
	defaults: Record<DeviceKind, string | null>;
	/**
	 * A lista não diz tudo: sem a permissão do microfone, o WebView2 esconde os nomes (e às vezes
	 * os ids), e a lista não serve para saber se um dispositivo sumiu.
	 */
	hidden: boolean;
}

/** O que o `enumerateDevices` devolve e esta lista usa. */
export type DeviceInfo = Pick<
	MediaDeviceInfo,
	"kind" | "deviceId" | "label" | "groupId"
>;

const KINDS: Partial<Record<MediaDeviceKind, DeviceKind>> = {
	audioinput: "input",
	audiooutput: "output",
};

/**
 * As duas entradas que o Chromium põe no Windows por conta própria: "default" (o padrão do
 * Windows) e "communications" (o padrão de comunicação). Não são dispositivos: o seletor tem o
 * seu próprio "Padrão do Windows".
 */
const VIRTUAL_IDS: ReadonlySet<string> = new Set(["default", "communications"]);

/** Uma lista vazia que não diz nada: antes de ler, ou quando não deu para ler. */
export const UNKNOWN_DEVICES: AudioDevices = {
	input: [],
	output: [],
	defaults: { input: null, output: null },
	hidden: true,
};

/** Separa os microfones e as saídas do que o `enumerateDevices` devolveu, na ordem do Windows. */
export function readDevices(infos: readonly DeviceInfo[]): AudioDevices {
	const devices: AudioDevices = {
		input: [],
		output: [],
		defaults: { input: null, output: null },
		hidden: false,
	};
	for (const info of infos) {
		const kind = KINDS[info.kind];
		if (!kind) continue;
		if (!info.label) devices.hidden = true;
		if (info.deviceId === "" || VIRTUAL_IDS.has(info.deviceId)) continue;
		devices[kind].push({ id: info.deviceId, label: info.label });
	}
	// O "default" tem o mesmo `groupId` do dispositivo de verdade que o Windows usa agora.
	for (const info of infos) {
		const kind = KINDS[info.kind];
		if (!kind || info.deviceId !== "default" || !info.groupId) continue;
		const real = infos.find(
			(other) =>
				other.kind === info.kind &&
				other.groupId === info.groupId &&
				other.deviceId !== "" &&
				!VIRTUAL_IDS.has(other.deviceId),
		);
		devices.defaults[kind] = real?.label || null;
	}
	return devices;
}

/** A lista de um tipo, ou `null` quando ela não serve para dizer se algo sumiu. */
export function knownDevices(
	devices: AudioDevices | null,
	kind: DeviceKind,
): readonly AudioDevice[] | null {
	return devices && !devices.hidden ? devices[kind] : null;
}

/** Um dispositivo escolhido: o id e o nome, para o seletor dizer qual está desconectado. */
export interface ChosenDevice {
	id: string;
	label: string;
}

/**
 * O id que a chamada usa: o escolhido, se está conectado; senão o padrão do Windows (`null`). Sem
 * uma lista que sirva (`null`), vale o escolhido: a chamada tenta e, se ele não existir, o
 * WebView2 abre o padrão.
 */
export function effectiveDevice(
	chosen: ChosenDevice | null,
	available: readonly AudioDevice[] | null,
): string | null {
	if (!chosen) return null;
	if (!available) return chosen.id;
	return available.some((device) => device.id === chosen.id) ? chosen.id : null;
}

/** Se o escolhido está desconectado agora (e a chamada usa o padrão do Windows no lugar dele). */
export function isMissing(
	chosen: ChosenDevice | null,
	available: readonly AudioDevice[] | null,
): boolean {
	return chosen !== null && effectiveDevice(chosen, available) === null;
}

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

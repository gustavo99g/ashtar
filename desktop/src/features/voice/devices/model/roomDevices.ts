/**
 * Leva a escolha dos dispositivos (`devices.ts`) para a sala do LiveKit: ao entrar, pelas opções
 * da `Room`, e no meio da chamada, pelo `switchActiveDevice`. Quem usa é o `VoiceProvider`.
 */
import type { Room, RoomOptions } from "livekit-client";
import type { DeviceKind } from "./devices";

/** Os ids que a chamada usa; `null` é o padrão do Windows. */
export type DeviceIds = Record<DeviceKind, string | null>;

/** O id que o LiveKit (e o WebView2) entendem como o padrão do Windows. */
const SYSTEM_DEFAULT = "default";

const MEDIA_KIND = { input: "audioinput", output: "audiooutput" } as const;

/** As opções da `Room` para entrar já com os dispositivos escolhidos. Sem escolha, as do LiveKit. */
export function roomOptions({ input, output }: DeviceIds): RoomOptions {
	return {
		// `ideal`: se o microfone sumiu entre a leitura da lista e a entrada, o WebView2 abre o
		// padrão em vez de falhar.
		...(input ? { audioCaptureDefaults: { deviceId: { ideal: input } } } : {}),
		...(output ? { audioOutput: { deviceId: output } } : {}),
	};
}

/**
 * Troca o dispositivo de `kind` na chamada, se ele mudou. Com o microfone mutado, o LiveKit só
 * guarda a troca e abre o novo ao desmutar. Uma falha fica no log e a chamada segue no de antes.
 */
export async function switchDevice(
	room: Room,
	kind: DeviceKind,
	id: string | null,
): Promise<void> {
	const target = id ?? SYSTEM_DEFAULT;
	const mediaKind = MEDIA_KIND[kind];
	if (room.getActiveDevice(mediaKind) === target) return;
	try {
		await room.switchActiveDevice(mediaKind, target);
	} catch (error) {
		console.warn(
			`Não foi possível trocar o dispositivo (${mediaKind}):`,
			error,
		);
	}
}

/**
 * A câmera (ADR 0025): as qualidades, a lista de câmeras deste computador e as opções com que o
 * livekit-client abre e publica a câmera. Aqui só as regras, sem React nem zustand.
 *
 * A câmera sai pelo próprio livekit-client, na conexão da voz (não pelo Rust, como a tela), com
 * camadas (simulcast): quem vê a pessoa num bloco pequeno baixa a camada leve (`subscriptions.ts`).
 * Sempre a 30 fps.
 *
 * A escolha da câmera segue a do microfone (`devices.ts`): nada escolhido é a câmera padrão do
 * Windows; uma escolhida que sumiu continua escolhida, e enquanto ela não volta vale a padrão.
 */
import {
	type TrackPublishOptions,
	type VideoCaptureOptions,
	VideoPresets,
} from "livekit-client";
import type { ChosenDevice, DeviceInfo } from "../../devices/model/devices";

export type CameraQuality = "480p" | "720p" | "1080p";

export interface CameraPreset {
	label: string;
	width: number;
	height: number;
	/** O teto da camada mais alta, em bps. */
	maxBitrate: number;
}

export const CAMERA_FPS = 30;

export const CAMERA_PRESETS = {
	"480p": { label: "480p", width: 854, height: 480, maxBitrate: 900_000 },
	"720p": { label: "720p", width: 1280, height: 720, maxBitrate: 1_700_000 },
	"1080p": { label: "1080p", width: 1920, height: 1080, maxBitrate: 3_000_000 },
} satisfies Record<CameraQuality, CameraPreset>;

export const CAMERA_QUALITIES: readonly CameraQuality[] = ["480p", "720p", "1080p"];

export const DEFAULT_CAMERA_QUALITY: CameraQuality = "720p";

export function isCameraQuality(value: unknown): value is CameraQuality {
	return typeof value === "string" && value in CAMERA_PRESETS;
}

export interface CameraDevice {
	id: string;
	/** O nome que o Windows dá; vazio enquanto o WebView2 esconde (antes de abrir a câmera). */
	label: string;
}

/** As câmeras do que o `enumerateDevices` devolveu, na ordem do Windows. */
export function readCameras(infos: readonly DeviceInfo[]): CameraDevice[] {
	return infos
		.filter((info) => info.kind === "videoinput" && info.deviceId !== "")
		.map((info) => ({ id: info.deviceId, label: info.label }));
}

/** A câmera que vale agora: a escolhida, se está ligada no computador; senão a padrão (`null`). */
export function effectiveCamera(
	chosen: ChosenDevice | null,
	cameras: readonly CameraDevice[] | null,
): string | null {
	if (!chosen) return null;
	// Sem a lista (ainda não lida), vale a escolhida.
	if (!cameras) return chosen.id;
	return cameras.some((camera) => camera.id === chosen.id) ? chosen.id : null;
}

/** Como abrir a câmera: o dispositivo (ou o padrão) e o tamanho da qualidade, a 30 fps. */
export function cameraCapture(
	deviceId: string | null,
	quality: CameraQuality,
): VideoCaptureOptions {
	const { width, height } = CAMERA_PRESETS[quality];
	return {
		...(deviceId ? { deviceId: { exact: deviceId } } : {}),
		resolution: { width, height, frameRate: CAMERA_FPS },
	};
}

/** Como publicar: com camadas, a mais alta no teto da qualidade. */
export function cameraPublish(quality: CameraQuality): TrackPublishOptions {
	return {
		simulcast: true,
		videoEncoding: {
			maxBitrate: CAMERA_PRESETS[quality].maxBitrate,
			maxFramerate: CAMERA_FPS,
		},
		videoSimulcastLayers:
			quality === "480p"
				? [VideoPresets.h180]
				: [VideoPresets.h180, VideoPresets.h360],
	};
}

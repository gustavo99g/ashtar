/**
 * A escolha da câmera, guardada neste computador (`localStorage`, como o microfone): o dispositivo,
 * a qualidade e o Espelhar. Vale na prévia, no botão Câmera e em Configurações › Voz e vídeo. Ligada
 * ou não, ela nunca fica gravada: a câmera sempre começa desligada (ADR 0025).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChosenDevice } from "../../devices/model/devices";
import {
	type CameraDevice,
	type CameraQuality,
	DEFAULT_CAMERA_QUALITY,
	isCameraQuality,
} from "../model/camera";

interface CameraChoice {
	/** `null`: a câmera padrão do Windows. */
	device: ChosenDevice | null;
	quality: CameraQuality;
	/** Só para a própria pessoa: os outros sempre veem a imagem como sai da câmera. */
	mirror: boolean;
}

const DEFAULT_CHOICE: CameraChoice = {
	device: null,
	quality: DEFAULT_CAMERA_QUALITY,
	mirror: true,
};

function readDevice(value: unknown): ChosenDevice | null {
	if (typeof value !== "object" || value === null) return null;
	const { id, label } = value as Partial<ChosenDevice>;
	return typeof id === "string" && id !== "" && typeof label === "string"
		? { id, label }
		: null;
}

export const useCameraChoice = create<CameraChoice>()(
	persist(() => DEFAULT_CHOICE, {
		name: "ashtar-camera",
		version: 1,
		// Um valor estranho no disco volta para o padrão.
		merge: (persisted, current) => {
			const saved = persisted as Partial<Record<keyof CameraChoice, unknown>> | undefined;
			return {
				...current,
				device: readDevice(saved?.device),
				quality: isCameraQuality(saved?.quality)
					? saved.quality
					: DEFAULT_CAMERA_QUALITY,
				mirror: saved?.mirror !== false,
			};
		},
	}),
);

/** `null` volta para a câmera padrão do Windows. */
export function chooseCamera(device: CameraDevice | null): void {
	useCameraChoice.setState({
		device: device && { id: device.id, label: device.label },
	});
}

export function chooseCameraQuality(quality: CameraQuality): void {
	useCameraChoice.setState({ quality });
}

export function setCameraMirror(mirror: boolean): void {
	useCameraChoice.setState({ mirror });
}

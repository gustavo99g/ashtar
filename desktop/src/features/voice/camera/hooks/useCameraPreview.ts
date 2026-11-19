import { useEffect, useState } from "react";
import { type CameraQuality, cameraCapture } from "../model/camera";

export type PreviewState =
	| { status: "off" }
	| { status: "opening" }
	| { status: "on"; stream: MediaStream }
	| { status: "error"; message: string };

/**
 * A prévia da câmera, só para a própria pessoa: abre a câmera escolhida, na qualidade escolhida,
 * enquanto `active`, e fecha ao sair (a luz da câmera apaga). Com a câmera já ligada na sala, quem
 * mostra é a própria trilha publicada, e esta fica desligada.
 */
export function useCameraPreview(
	active: boolean,
	deviceId: string | null,
	quality: CameraQuality,
): PreviewState {
	const [state, setState] = useState<PreviewState>({ status: "off" });

	useEffect(() => {
		const media = navigator.mediaDevices as MediaDevices | undefined;
		if (!active || !media?.getUserMedia) {
			setState({ status: "off" });
			return;
		}
		let alive = true;
		let stream: MediaStream | null = null;
		setState({ status: "opening" });
		const { deviceId: exact, resolution } = cameraCapture(deviceId, quality);
		Promise.resolve()
			.then(() => media.getUserMedia({
				video: {
					...(exact ? { deviceId: exact } : {}),
					width: resolution?.width,
					height: resolution?.height,
					frameRate: resolution?.frameRate,
				},
			}))
			.then((opened) => {
				if (!alive) {
					for (const track of opened.getTracks()) track.stop();
					return;
				}
				stream = opened;
				setState({ status: "on", stream: opened });
			})
			.catch((error: unknown) => {
				console.warn("Não foi possível abrir a prévia da câmera:", error);
				if (alive) {
					setState({
						status: "error",
						message:
							"Não deu para abrir a câmera. Confira se outro programa está usando ela.",
					});
				}
			});
		return () => {
			alive = false;
			if (stream) for (const track of stream.getTracks()) track.stop();
		};
	}, [active, deviceId, quality]);

	return state;
}

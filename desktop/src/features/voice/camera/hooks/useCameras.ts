import { useEffect, useState } from "react";
import { type CameraDevice, readCameras } from "../model/camera";

/**
 * As câmeras deste computador, lidas de novo a cada `devicechange` e quando `refresh` muda (a prévia
 * abriu a câmera, e o WebView2 passou a dizer os nomes). `null` até a primeira leitura.
 */
export function useCameras(refresh: unknown = null): CameraDevice[] | null {
	const [cameras, setCameras] = useState<CameraDevice[] | null>(null);

	useEffect(() => {
		const media = navigator.mediaDevices as MediaDevices | undefined;
		if (!media?.enumerateDevices) {
			setCameras([]);
			return;
		}
		let alive = true;
		let latest = 0;
		const read = async () => {
			const call = ++latest;
			let next: CameraDevice[] = [];
			try {
				next = readCameras(await media.enumerateDevices());
			} catch (error) {
				console.warn("Não foi possível listar as câmeras:", error);
			}
			if (alive && call === latest) setCameras(next);
		};
		const onChange = () => void read();
		void read();
		media.addEventListener("devicechange", onChange);
		return () => {
			alive = false;
			media.removeEventListener("devicechange", onChange);
		};
	}, [refresh]);

	return cameras;
}

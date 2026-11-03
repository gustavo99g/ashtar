import { useEffect, useState } from "react";
import { type AudioDevices, readDevices, UNKNOWN_DEVICES } from "../model/devices";

/**
 * Os microfones e as saídas deste computador, lidos de novo a cada `devicechange` (um fone USB ou
 * Bluetooth ligado ou desligado, ou o padrão trocado no Windows). `null` até a primeira leitura.
 *
 * Com `revealNames`, se o WebView2 esconder os nomes (o app ainda não usou o microfone neste
 * computador), abre o microfone um instante e lê de novo: o app libera o microfone sem perguntar
 * (`permissions.rs`), e o WebView2 guarda a permissão. Só a tela de Voz e vídeo pede isso.
 */
export function useAudioDevices({ revealNames = false } = {}) {
	const [devices, setDevices] = useState<AudioDevices | null>(null);

	useEffect(() => {
		const media = navigator.mediaDevices as MediaDevices | undefined;
		if (!media?.enumerateDevices) {
			setDevices(UNKNOWN_DEVICES);
			return;
		}
		let alive = true;
		let latest = 0;
		let asked = false;

		const read = async () => {
			// Dois `devicechange` seguidos: só a última leitura vale.
			const call = ++latest;
			let next = UNKNOWN_DEVICES;
			try {
				next = readDevices(await media.enumerateDevices());
			} catch (error) {
				console.warn(
					"Não foi possível listar os dispositivos de áudio:",
					error,
				);
			}
			if (!alive || call !== latest) return;
			setDevices(next);
			if (next.hidden && revealNames && !asked) {
				asked = true;
				if ((await unlockNames(media)) && alive) void read();
			}
		};

		const onChange = () => void read();
		void read();
		media.addEventListener("devicechange", onChange);
		return () => {
			alive = false;
			media.removeEventListener("devicechange", onChange);
		};
	}, [revealNames]);

	return devices;
}

/** Abre e fecha o microfone, para o WebView2 passar a dizer os nomes. */
async function unlockNames(media: MediaDevices): Promise<boolean> {
	try {
		const stream = await media.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
		return true;
	} catch (error) {
		console.warn(
			"Sem o microfone, os nomes dos dispositivos ficam escondidos:",
			error,
		);
		return false;
	}
}

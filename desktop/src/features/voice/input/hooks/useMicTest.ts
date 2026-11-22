import { useContext, useEffect, useRef, useState } from "react";
import { useDeviceChoice } from "../../devices/stores/deviceChoiceStore";
import { VoiceContext } from "../../room/components/VoiceProvider";
import {
	buildInputGraph,
	type ChainOptions,
	captureConstraints,
	type InputGraph,
} from "../chain";
import { useInputChoice } from "../stores/inputStore";

/**
 * O "Testar microfone" de Configurações › Voz e vídeo (ADR 0029). Fora de uma sala, abre o
 * microfone escolhido pela mesma cadeia da chamada e devolve o som na saída escolhida, para a
 * pessoa se ouvir como os outros a ouviriam. Numa sala, não toca nada (seria eco para os outros):
 * o medidor lê a trilha publicada. Parar, ou sair da tela, fecha tudo.
 */
export function useMicTest(): {
	testing: boolean;
	/** Numa sala: o teste só mostra o nível. */
	inRoom: boolean;
	failed: boolean;
	toggle: () => void;
} {
	const voice = useContext(VoiceContext);
	const inRoom = voice?.room != null;
	const [testing, setTesting] = useState(false);
	const [failed, setFailed] = useState(false);
	const choice = useInputChoice();
	const input = useDeviceChoice((state) => state.input?.id ?? null);
	const output = useDeviceChoice((state) => state.output?.id ?? null);

	const options: ChainOptions = {
		suppression: choice.suppression,
		echoCancellation: choice.echoCancellation,
		autoGainControl: choice.autoGainControl,
		volume: choice.volume,
		mode: choice.mode,
		autoSensitivity: choice.autoSensitivity,
		thresholdDb: choice.thresholdDb,
	};
	const latest = useRef(options);
	latest.current = options;
	const graph = useRef<InputGraph | null>(null);
	const loopback = !inRoom && testing;

	// A cadeia do teste: refeita quando muda o que exige outro microfone ou outro grafo.
	useEffect(() => {
		if (!loopback) return;
		let cancelled = false;
		let stop: (() => void) | null = null;
		setFailed(false);
		startLoopback(input, output, latest.current)
			.then((test) => {
				if (cancelled) test.stop();
				else {
					graph.current = test.graph;
					stop = test.stop;
				}
			})
			.catch((error: unknown) => {
				console.warn("O teste do microfone não abriu:", error);
				if (!cancelled) {
					setFailed(true);
					setTesting(false);
				}
			});
		return () => {
			cancelled = true;
			graph.current = null;
			stop?.();
		};
	}, [
		loopback,
		input,
		output,
		choice.suppression,
		choice.echoCancellation,
		choice.autoGainControl,
	]);

	// O volume e a sensibilidade mudam no grafo do teste, sem reabrir o microfone.
	useEffect(() => {
		graph.current?.update(latest.current);
	}, [choice.volume, choice.mode, choice.autoSensitivity, choice.thresholdDb]);

	return {
		testing,
		inRoom,
		failed,
		toggle: () => setTesting((value) => !value),
	};
}

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

async function startLoopback(
	input: string | null,
	output: string | null,
	options: ChainOptions,
): Promise<{ graph: InputGraph; stop: () => void }> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			...(input ? { deviceId: { ideal: input } } : {}),
			...captureConstraints(options, options.suppression),
		},
	});
	const mic = stream.getAudioTracks()[0];
	let graph: InputGraph;
	try {
		graph = await buildInputGraph(mic, options);
	} catch (error) {
		mic.stop();
		throw error;
	}
	if (options.suppression && !graph.rnnoise) {
		await mic
			.applyConstraints(captureConstraints(options, false))
			.catch(() => {});
	}
	const audio = new Audio() as SinkAudio;
	audio.srcObject = new MediaStream([graph.output]);
	if (output && audio.setSinkId) await audio.setSinkId(output).catch(() => {});
	await audio.play().catch(() => {});
	return {
		graph,
		stop: () => {
			audio.pause();
			audio.srcObject = null;
			void graph.close();
			mic.stop();
		},
	};
}

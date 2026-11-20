import { useEffect, useState } from "react";
import { useVoice } from "../../room/hooks/useVoice";
import { cloneMicrophone, isPushToTalkHeld } from "../chain";
import { GateState, levelDb } from "../model/gate";
import { MutedWarningState, WARNING_MS } from "../model/mutedWarning";
import { useInputChoice } from "../stores/inputStore";

const BLOCK_MS = 100;

/**
 * O aviso "Você está mutado" (ADR 0029, decisão 18): com o microfone mutado numa sala (e não
 * surdo), mede a voz num clone do microfone, com a mesma sensibilidade do portão, e mostra o aviso
 * por 3 segundos quando a pessoa fala. No pressionar para falar, só com o atalho apertado. A chave
 * fica em Voz e vídeo.
 */
export function useMutedWarning(): boolean {
	const { room, connectionState, isMuted, isDeafened } = useVoice();
	const warn = useInputChoice((state) => state.warnWhenMuted);
	const active =
		room !== null &&
		connectionState === "connected" &&
		isMuted &&
		!isDeafened &&
		warn;
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (!active || !room) {
			setVisible(false);
			return;
		}
		const track = cloneMicrophone(room);
		if (!track) return;
		let context: AudioContext;
		try {
			context = new AudioContext();
		} catch {
			track.stop();
			return;
		}
		const source = context.createMediaStreamSource(new MediaStream([track]));
		const analyser = context.createAnalyser();
		analyser.fftSize = 2048;
		source.connect(analyser);
		const samples = new Float32Array(analyser.fftSize);
		const gate = new GateState();
		const warning = new MutedWarningState();
		let hide: ReturnType<typeof setTimeout> | undefined;

		const timer = setInterval(() => {
			const choice = useInputChoice.getState();
			if (choice.mode === "ptt" && !isPushToTalkHeld()) {
				warning.step(false, BLOCK_MS);
				return;
			}
			analyser.getFloatTimeDomainData(samples);
			// O volume de entrada conta, como na cadeia.
			const gainDb = 20 * Math.log10(Math.max(choice.volume, 1) / 100);
			const speaking = gate.step(levelDb(samples) + gainDb, BLOCK_MS, {
				mode: "voice",
				auto: choice.autoSensitivity,
				thresholdDb: choice.thresholdDb,
				held: false,
			});
			if (warning.step(speaking, BLOCK_MS)) {
				setVisible(true);
				clearTimeout(hide);
				hide = setTimeout(() => setVisible(false), WARNING_MS);
			}
		}, BLOCK_MS);

		return () => {
			clearInterval(timer);
			clearTimeout(hide);
			source.disconnect();
			track.stop();
			void context.close().catch(() => {});
			setVisible(false);
		};
	}, [active, room]);

	return visible;
}

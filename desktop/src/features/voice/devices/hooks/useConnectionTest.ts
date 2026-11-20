import { LocalAudioTrack, Room, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createTestToken } from "@/lib/api";
import { useMaybeVoice } from "../../room/hooks/useMaybeVoice";
import {
	type ConnectionTestResult,
	readResult,
} from "../model/connectionTest";

/** Quanto o som mudo fica no ar antes de ler os números. */
const SEND_MS = 4000;

export type ConnectionTestState =
	| { status: "idle" }
	| { status: "running" }
	| { status: "done"; result: ConnectionTestResult }
	| { status: "failed"; message: string };

/**
 * O Testar conexão. Numa sala, lê a conexão de agora (o microfone, ou o áudio de alguém); fora,
 * entra na sala só da pessoa, publica um som mudo e lê os números. Sair da tela no meio cancela.
 */
export function useConnectionTest() {
	const voice = useMaybeVoice();
	const room = voice?.room ?? null;
	const [state, setState] = useState<ConnectionTestState>({ status: "idle" });
	const run = useRef(0);

	useEffect(
		() => () => {
			run.current += 1;
		},
		[],
	);

	const start = useCallback(async () => {
		const id = ++run.current;
		setState({ status: "running" });
		try {
			const result = room ? await readRoom(room) : await testAlone();
			if (run.current === id) setState({ status: "done", result });
		} catch (error) {
			console.warn("O Testar conexão falhou:", error);
			if (run.current === id) {
				setState({
					status: "failed",
					message:
						"Não deu para conectar ao servidor de voz. Confira a internet e tente de novo.",
				});
			}
		}
	}, [room]);

	return { state, start, inRoom: room !== null };
}

async function readRoom(room: Room): Promise<ConnectionTestResult> {
	const track =
		room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track ??
		[...room.remoteParticipants.values()]
			.flatMap((participant) => [...participant.audioTrackPublications.values()])
			.find((publication) => publication.track)?.track;
	if (!track) throw new Error("nenhuma trilha de áudio na sala");
	const report = await track.getRTCStatsReport();
	if (!report) throw new Error("sem os números da conexão");
	const result = readResult(report);
	// Mutado, nada sai, e não quer dizer que não sairia.
	return { ...result, sending: result.sending || !room.localParticipant.isMicrophoneEnabled };
}

async function testAlone(): Promise<ConnectionTestResult> {
	const { url, token } = await createTestToken();
	const room = new Room();
	const audio = new AudioContext();
	try {
		await room.connect(url, token, { autoSubscribe: false });
		// Um som mudo: dá para ver os pacotes saindo sem abrir o microfone.
		const destination = audio.createMediaStreamDestination();
		const oscillator = audio.createOscillator();
		const silence = audio.createGain();
		silence.gain.value = 0;
		oscillator.connect(silence).connect(destination);
		oscillator.start();
		const track = new LocalAudioTrack(
			destination.stream.getAudioTracks()[0],
			undefined,
			false,
		);
		await room.localParticipant.publishTrack(track);
		await new Promise((resolve) => setTimeout(resolve, SEND_MS));
		const report = await track.getRTCStatsReport();
		if (!report) throw new Error("sem os números da conexão");
		return readResult(report);
	} finally {
		await room.disconnect();
		await audio.close().catch(() => {});
	}
}

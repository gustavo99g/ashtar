import type { TrackReference } from "@livekit/components-react";
import { act, render, screen } from "@testing-library/react";
import { RemoteAudioTrack, type Room, RoomEvent, Track } from "livekit-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	setUserVolume,
	toggleUserMuted,
	useUserVolumes,
} from "../../members/stores/userVolumeStore";
import { RoomAudio } from "../components/RoomAudio";
import { followOutput } from "../model/boost";

vi.mock("../model/boost", async (importOriginal) => ({
	...(await importOriginal<typeof import("../model/boost")>()),
	followOutput: vi.fn(),
}));

/** As trilhas que a sala tem; o `AudioTrack` de mentira mostra se ela toca ou está calada. */
let tracks: TrackReference[] = [];

vi.mock("@livekit/components-react", () => ({
	useTracks: () => tracks,
	AudioTrack: ({
		trackRef,
		muted,
	}: {
		trackRef: TrackReference;
		muted?: boolean;
	}) => (
		<span data-testid={trackRef.publication.trackSid}>
			{muted ? "calada" : "toca"}
		</span>
	),
}));

function track(
	identity: string,
	source: Track.Source,
	{ isLocal = false, kind = Track.Kind.Audio } = {},
): TrackReference {
	return {
		participant: { identity, isLocal },
		publication: { trackSid: `${identity}-${source}`, kind },
		source,
	} as unknown as TrackReference;
}

/** Uma voz com trilha de verdade o bastante para o volume: passa no `instanceof`. */
function voice(identity: string) {
	const audio = Object.assign(
		Object.create(RemoteAudioTrack.prototype) as RemoteAudioTrack,
		{
			attachedElements: [],
			setVolume: vi.fn(),
			setAudioContext: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		},
	);
	const ref = track(identity, Track.Source.Microphone);
	(ref.publication as { track?: unknown }).track = audio;
	return { ref, audio };
}

beforeEach(() => {
	localStorage.clear();
	useUserVolumes.setState({ volumes: {} });
});

const SALA = [
	track("marcao", Track.Source.Microphone),
	track("juju", Track.Source.Microphone),
	track("juju", Track.Source.ScreenShareAudio),
];

describe("o som da sala", () => {
	it("toca a voz de todos e o áudio da transmissão", () => {
		tracks = SALA;
		render(<RoomAudio room={null} deafened={false} />);

		expect(screen.getByTestId("marcao-microphone")).toHaveTextContent("toca");
		expect(screen.getByTestId("juju-microphone")).toHaveTextContent("toca");
		expect(screen.getByTestId("juju-screen_share_audio")).toHaveTextContent(
			"toca",
		);
	});

	it("o deafen cala só as vozes: a transmissão continua com som", () => {
		tracks = SALA;
		render(<RoomAudio room={null} deafened />);

		expect(screen.getByTestId("marcao-microphone")).toHaveTextContent("calada");
		expect(screen.getByTestId("juju-microphone")).toHaveTextContent("calada");
		expect(screen.getByTestId("juju-screen_share_audio")).toHaveTextContent(
			"toca",
		);
	});

	it("não toca o próprio microfone nem trilha de vídeo", () => {
		tracks = [
			track("kid", Track.Source.Microphone, { isLocal: true }),
			track("juju", Track.Source.Unknown, { kind: Track.Kind.Video }),
		];
		render(<RoomAudio room={null} deafened={false} />);

		expect(screen.queryByTestId("kid-microphone")).not.toBeInTheDocument();
		expect(screen.queryByTestId("juju-unknown")).not.toBeInTheDocument();
	});
	it("cada voz toca no volume que você escolheu para a pessoa, e muda na hora", () => {
		const juju = voice("juju");
		const marcao = voice("marcao");
		setUserVolume("juju", 60);
		tracks = [juju.ref, marcao.ref];
		render(<RoomAudio room={null} deafened={false} />);

		expect(juju.audio.setVolume).toHaveBeenLastCalledWith(0.6);
		expect(marcao.audio.setVolume).toHaveBeenLastCalledWith(1);

		act(() => toggleUserMuted("marcao"));
		expect(marcao.audio.setVolume).toHaveBeenLastCalledWith(0);
		expect(juju.audio.setVolume).toHaveBeenLastCalledWith(0.6);
	});

	it("o deafen manda: cala a voz sem apagar o volume guardado", () => {
		const juju = voice("juju");
		setUserVolume("juju", 60);
		tracks = [juju.ref];
		const { rerender } = render(<RoomAudio room={null} deafened />);
		expect(screen.getByTestId("juju-microphone")).toHaveTextContent("calada");

		rerender(<RoomAudio room={null} deafened={false} />);

		expect(screen.getByTestId("juju-microphone")).toHaveTextContent("toca");
		expect(juju.audio.setVolume).toHaveBeenLastCalledWith(0.6);
	});

	it("trocar a saída de áudio da sala leva o reforço junto", () => {
		const handlers = new Map<string, (kind: MediaDeviceKind) => void>();
		const room = {
			on: (event: string, handler: (kind: MediaDeviceKind) => void) =>
				handlers.set(event, handler),
			off: vi.fn(),
		} as unknown as Room;
		tracks = [];
		render(<RoomAudio room={room} deafened={false} />);

		handlers.get(RoomEvent.ActiveDeviceChanged)?.("audioinput");
		expect(followOutput).not.toHaveBeenCalled();

		handlers.get(RoomEvent.ActiveDeviceChanged)?.("audiooutput");
		expect(followOutput).toHaveBeenCalledWith(room);
	});
});

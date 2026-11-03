import type { TrackReference } from "@livekit/components-react";
import { render, screen } from "@testing-library/react";
import { Track } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { RoomAudio } from "../components/RoomAudio";

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

const SALA = [
	track("marcao", Track.Source.Microphone),
	track("juju", Track.Source.Microphone),
	track("juju", Track.Source.ScreenShareAudio),
];

describe("o som da sala", () => {
	it("toca a voz de todos e o áudio da transmissão", () => {
		tracks = SALA;
		render(<RoomAudio deafened={false} />);

		expect(screen.getByTestId("marcao-microphone")).toHaveTextContent("toca");
		expect(screen.getByTestId("juju-microphone")).toHaveTextContent("toca");
		expect(screen.getByTestId("juju-screen_share_audio")).toHaveTextContent(
			"toca",
		);
	});

	it("o deafen cala só as vozes: a transmissão continua com som", () => {
		tracks = SALA;
		render(<RoomAudio deafened />);

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
		render(<RoomAudio deafened={false} />);

		expect(screen.queryByTestId("kid-microphone")).not.toBeInTheDocument();
		expect(screen.queryByTestId("juju-unknown")).not.toBeInTheDocument();
	});
});

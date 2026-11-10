import { type RemoteParticipant, type Room, Track } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { syncSubscriptions, wantsTrack } from "../model/subscriptions";

/** Uma publicação de mentira: a fonte, o desejo de agora e o `setSubscribed` observado. */
function publication(source: Track.Source, desired: boolean) {
	const pub = {
		source,
		isDesired: desired,
		setSubscribed: vi.fn((value: boolean) => {
			pub.isDesired = value;
		}),
	};
	return pub;
}

function roomWith(
	people: Record<string, ReturnType<typeof publication>[]>,
): Room {
	const remoteParticipants = new Map(
		Object.entries(people).map(([identity, pubs]) => [
			identity,
			{
				identity,
				trackPublications: new Map(
					pubs.map((pub, index) => [`${identity}-${index}`, pub]),
				),
			} as unknown as RemoteParticipant,
		]),
	);
	return {
		remoteParticipants,
		localParticipant: { identity: "eu" },
	} as unknown as Room;
}

describe("o que a sala baixa", () => {
	it("a voz sempre; a tela e o áudio dela só de quem está no palco", () => {
		const want = (
			source: Track.Source,
			identity: string,
			shown: string | null,
		) => wantsTrack(source, identity, shown, "eu");
		expect(want(Track.Source.Microphone, "juju", null)).toBe(true);
		expect(want(Track.Source.ScreenShare, "juju:screen", null)).toBe(false);
		expect(want(Track.Source.ScreenShareAudio, "juju:screen", null)).toBe(
			false,
		);
		expect(want(Track.Source.ScreenShare, "juju:screen", "juju")).toBe(true);
		expect(want(Track.Source.ScreenShareAudio, "juju:screen", "juju")).toBe(
			true,
		);
		expect(want(Track.Source.ScreenShare, "juju:screen", "marcao")).toBe(false);
	});

	it("nunca a própria tela, nem o áudio dela", () => {
		for (const source of [
			Track.Source.ScreenShare,
			Track.Source.ScreenShareAudio,
		]) {
			expect(wantsTrack(source, "eu:screen", "eu", "eu")).toBe(false);
		}
	});

	it("assina e cancela só o que muda", () => {
		const mic = publication(Track.Source.Microphone, false);
		const screen = publication(Track.Source.ScreenShare, false);
		const screenAudio = publication(Track.Source.ScreenShareAudio, false);
		const otherMic = publication(Track.Source.Microphone, true);
		const room = roomWith({
			juju: [mic],
			"juju:screen": [screen, screenAudio],
			marcao: [otherMic],
		});

		// Na Grade: só as vozes.
		syncSubscriptions(room, null);
		expect(mic.setSubscribed).toHaveBeenCalledWith(true);
		expect(screen.setSubscribed).not.toHaveBeenCalled();
		expect(screenAudio.setSubscribed).not.toHaveBeenCalled();
		expect(otherMic.setSubscribed).not.toHaveBeenCalled();

		// A juju no palco: a tela e o áudio dela.
		syncSubscriptions(room, "juju");
		expect(screen.setSubscribed).toHaveBeenLastCalledWith(true);
		expect(screenAudio.setSubscribed).toHaveBeenLastCalledWith(true);
		expect(mic.setSubscribed).toHaveBeenCalledTimes(1);

		// De volta à Grade: a tela sai, a voz fica.
		syncSubscriptions(room, null);
		expect(screen.setSubscribed).toHaveBeenLastCalledWith(false);
		expect(screenAudio.setSubscribed).toHaveBeenLastCalledWith(false);
		expect(mic.setSubscribed).toHaveBeenCalledTimes(1);
	});
});

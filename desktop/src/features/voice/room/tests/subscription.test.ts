import {
	type RemoteParticipant,
	type Room,
	Track,
	VideoQuality,
} from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import {
	NOTHING_SHOWN,
	type SubscriptionView,
	syncSubscriptions,
	wantedQuality,
	wantsTrack,
} from "../model/subscriptions";

/** Só a transmissão de `owner`, grande. */
const watching = (owner: string): SubscriptionView => ({
	shown: { [owner]: "full" },
	cameras: false,
});

/** Uma publicação de mentira: a fonte, o desejo de agora e o `setSubscribed` observado. */
function publication(source: Track.Source, desired: boolean) {
	const pub = {
		source,
		isDesired: desired,
		videoQuality: undefined as VideoQuality | undefined,
		setSubscribed: vi.fn((value: boolean) => {
			pub.isDesired = value;
		}),
		setVideoQuality: vi.fn((value: VideoQuality) => {
			pub.videoQuality = value;
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
		) =>
			wantsTrack(source, identity, shown ? watching(shown) : NOTHING_SHOWN, "eu");
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
			expect(wantsTrack(source, "eu:screen", watching("eu"), "eu")).toBe(false);
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
		syncSubscriptions(room, NOTHING_SHOWN);
		expect(mic.setSubscribed).toHaveBeenCalledWith(true);
		expect(screen.setSubscribed).not.toHaveBeenCalled();
		expect(screenAudio.setSubscribed).not.toHaveBeenCalled();
		expect(otherMic.setSubscribed).not.toHaveBeenCalled();

		// A juju no palco: a tela e o áudio dela.
		syncSubscriptions(room, watching("juju"));
		expect(screen.setSubscribed).toHaveBeenLastCalledWith(true);
		expect(screenAudio.setSubscribed).toHaveBeenLastCalledWith(true);
		expect(mic.setSubscribed).toHaveBeenCalledTimes(1);

		// De volta à Grade: a tela sai, a voz fica.
		syncSubscriptions(room, NOTHING_SHOWN);
		expect(screen.setSubscribed).toHaveBeenLastCalledWith(false);
		expect(screenAudio.setSubscribed).toHaveBeenLastCalledWith(false);
		expect(mic.setSubscribed).toHaveBeenCalledTimes(1);
	});

	it("várias transmissões ao mesmo tempo, cada uma na camada do seu tamanho", () => {
		const juju = publication(Track.Source.ScreenShare, false);
		const marcao = publication(Track.Source.ScreenShare, false);
		const rafa = publication(Track.Source.ScreenShare, false);
		const room = roomWith({
			"juju:screen": [juju],
			"marcao:screen": [marcao],
			"rafa:screen": [rafa],
		});
		syncSubscriptions(room, {
			shown: { juju: "full", marcao: "small" },
			cameras: false,
		});
		expect(juju.setSubscribed).toHaveBeenLastCalledWith(true);
		expect(marcao.setSubscribed).toHaveBeenLastCalledWith(true);
		expect(rafa.setSubscribed).not.toHaveBeenCalled();
		expect(juju.videoQuality).toBe(VideoQuality.HIGH);
		expect(marcao.videoQuality).toBe(VideoQuality.LOW);

		// Trocar o foco só troca a camada; ninguém é assinado de novo.
		syncSubscriptions(room, {
			shown: { juju: "small", marcao: "full" },
			cameras: false,
		});
		expect(juju.setSubscribed).toHaveBeenCalledTimes(1);
		expect(marcao.setSubscribed).toHaveBeenCalledTimes(1);
		expect(juju.videoQuality).toBe(VideoQuality.LOW);
		expect(marcao.videoQuality).toBe(VideoQuality.HIGH);
	});

	it("as câmeras só com os blocos da sala à vista, nunca a própria", () => {
		const view = (cameras: SubscriptionView["cameras"]) => ({
			shown: {},
			cameras,
		});
		expect(wantsTrack(Track.Source.Camera, "juju", view(false), "eu")).toBe(
			false,
		);
		expect(wantsTrack(Track.Source.Camera, "juju", view("full"), "eu")).toBe(
			true,
		);
		expect(wantsTrack(Track.Source.Camera, "eu", view("full"), "eu")).toBe(
			false,
		);
		expect(wantedQuality(Track.Source.Camera, "juju", view("full"))).toBe(
			VideoQuality.MEDIUM,
		);
		expect(wantedQuality(Track.Source.Camera, "juju", view("small"))).toBe(
			VideoQuality.LOW,
		);
	});
});

describe("a câmera em foco", () => {
	it("vem em alta; as outras, pequenas na faixa", () => {
		const view: SubscriptionView = {
			shown: {},
			cameras: "small",
			bigCamera: "ana",
		};
		expect(wantedQuality(Track.Source.Camera, "ana", view)).toBe(
			VideoQuality.HIGH,
		);
		expect(wantedQuality(Track.Source.Camera, "bia", view)).toBe(
			VideoQuality.LOW,
		);
	});
});

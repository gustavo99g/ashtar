import { RemoteAudioTrack, type Room } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTrackVolume, followOutput } from "../model/boost";

/** Uma trilha de mentira, mas que passa no `instanceof` de quem a usa. */
function fakeTrack() {
	const element = { muted: false } as HTMLMediaElement;
	const track = Object.assign(
		Object.create(RemoteAudioTrack.prototype) as RemoteAudioTrack,
		{
			attachedElements: [element],
			setVolume: vi.fn(),
			setAudioContext: vi.fn(),
		},
	);
	return { track, element };
}

function roomWithOutput(device: string) {
	return { getActiveDevice: () => device } as unknown as Room;
}

/** O contexto é um só para o módulo inteiro: os testes olham sempre o mesmo. */
const setSinkId = vi.fn(async () => {});
const created = vi.fn();

beforeEach(() => {
	vi.stubGlobal(
		"AudioContext",
		class {
			setSinkId = setSinkId;
			constructor() {
				created();
			}
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("o volume de uma trilha", () => {
	it("até 100%, é o volume do elemento, sem contexto", () => {
		const { track, element } = fakeTrack();

		applyTrackVolume(track, 80, null);

		expect(track.setVolume).toHaveBeenCalledWith(0.8);
		expect(track.setAudioContext).not.toHaveBeenCalled();
		expect(element.muted).toBe(false);
	});

	it("acima de 100%, o som passa pelo contexto e o elemento fica mudo", () => {
		const { track, element } = fakeTrack();

		applyTrackVolume(track, 180, roomWithOutput("fones"));

		expect(track.setAudioContext).toHaveBeenCalledTimes(1);
		expect(track.setAudioContext).toHaveBeenCalledWith(expect.any(Object));
		expect(element.muted).toBe(true);
		expect(track.setVolume).toHaveBeenCalledWith(1.8);
		expect(setSinkId).toHaveBeenCalledWith("fones");
	});

	it("voltando a 100% ou menos, o som volta para o elemento", () => {
		const { track, element } = fakeTrack();
		applyTrackVolume(track, 150, null);

		applyTrackVolume(track, 100, null);

		expect(track.setAudioContext).toHaveBeenLastCalledWith(undefined);
		expect(element.muted).toBe(false);
		expect(track.setVolume).toHaveBeenLastCalledWith(1);
	});

	it("várias trilhas reforçadas dividem o mesmo contexto, cada uma com o seu volume", () => {
		const a = fakeTrack();
		const b = fakeTrack();

		applyTrackVolume(a.track, 140, null);
		applyTrackVolume(b.track, 200, null);
		// Mudar o volume de quem já está reforçado não liga o contexto de novo.
		applyTrackVolume(a.track, 160, null);

		const contextOf = (t: typeof a) =>
			vi.mocked(t.track.setAudioContext).mock.calls[0][0];
		expect(contextOf(a)).toBe(contextOf(b));
		expect(a.track.setAudioContext).toHaveBeenCalledTimes(1);
		expect(a.track.setVolume).toHaveBeenLastCalledWith(1.6);
		expect(b.track.setVolume).toHaveBeenLastCalledWith(2);
		// O contexto do módulo é criado uma vez só, por mais trilhas que passem por ele.
		expect(created.mock.calls.length).toBeLessThanOrEqual(1);
	});

	it("trocar a saída da sala leva o contexto junto; a padrão é a string vazia", async () => {
		const { track } = fakeTrack();
		applyTrackVolume(track, 150, roomWithOutput("fones"));

		await followOutput(roomWithOutput("caixa"));
		expect(setSinkId).toHaveBeenLastCalledWith("caixa");

		await followOutput(roomWithOutput("default"));
		expect(setSinkId).toHaveBeenLastCalledWith("");
	});
});

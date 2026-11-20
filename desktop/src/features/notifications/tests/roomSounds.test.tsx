import { act, render } from "@testing-library/react";
import { EventEmitter } from "events";
import { RoomEvent } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings";
import { useMaybeVoice } from "@/features/voice";
import { RoomSounds } from "../components/RoomSounds";
import { playRoomSound, resetRoomSounds } from "../model/roomSounds";

vi.mock("@/features/voice", () => ({ useMaybeVoice: vi.fn() }));

const played: string[] = [];

beforeEach(() => {
	played.length = 0;
	resetRoomSounds();
	useSettingsStore.setState({
		roomSounds: {
			join: true,
			leave: true,
			mute: true,
			unmute: true,
			deafen: true,
			undeafen: true,
			shareStart: true,
			shareStop: true,
		},
	});
	vi.stubGlobal(
		"Audio",
		class {
			constructor(src: string) {
				played.push(src.split("/").pop() ?? src);
			}
			play() {
				return Promise.resolve();
			}
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Espera o `play` (que vem depois de uma promessa) acontecer. */
async function flush() {
	await act(async () => {
		await Promise.resolve();
	});
}

function names() {
	return played.map((file) => file.replace(/\.wav.*$/, "").replace(/^.*room-/, ""));
}

describe("os sons da sala", () => {
	it("a chave desligada cala só aquele som, e o mesmo som não repete em seguida", async () => {
		useSettingsStore.getState().setRoomSound("leave", false);
		expect(playRoomSound("leave")).toBe(false);
		expect(playRoomSound("join", { now: 1000 })).toBe(true);
		expect(playRoomSound("join", { now: 1500 })).toBe(false);
		expect(playRoomSound("join", { now: 3000 })).toBe(true);
		// O botão de ouvir toca mesmo desligado.
		expect(playRoomSound("leave", { force: true })).toBe(true);
	});

	it("entrar, trocar e sair tocam um som cada, e os outros entrando também", async () => {
		const room = Object.assign(new EventEmitter(), {
			localParticipant: { identity: "kid" },
		});
		let voice = {
			voiceKind: "room",
			voiceChannelId: "sala",
			connectionState: "connecting",
			room: null as unknown,
			isMuted: false,
			isDeafened: false,
		};
		vi.mocked(useMaybeVoice).mockImplementation(() => voice as never);
		const { rerender } = render(<RoomSounds />);
		expect(names()).toEqual([]);

		voice = { ...voice, connectionState: "connected", room };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["join"]);

		resetRoomSounds();
		act(() => {
			room.emit(RoomEvent.ParticipantConnected, { identity: "ana" });
			room.emit(RoomEvent.ParticipantConnected, { identity: "ana:screen" });
			// A própria transmissão não toca.
			room.emit(RoomEvent.ParticipantDisconnected, { identity: "kid:screen" });
			room.emit(RoomEvent.ParticipantDisconnected, { identity: "ana" });
		});
		await flush();
		expect(names()).toEqual(["join", "join", "share-start", "leave"]);

		// Ficar surdo (que também muta) toca só o do surdo.
		voice = { ...voice, isMuted: true, isDeafened: true };
		rerender(<RoomSounds />);
		voice = { ...voice, isMuted: false, isDeafened: true };
		rerender(<RoomSounds />);
		await flush();
		expect(names().slice(-2)).toEqual(["deafen", "unmute"]);

		// Trocar de sala: só o de entrar da nova.
		resetRoomSounds();
		played.length = 0;
		voice = { ...voice, voiceChannelId: "squad", connectionState: "connecting" };
		rerender(<RoomSounds />);
		voice = { ...voice, connectionState: "connected" };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["join"]);

		voice = { ...voice, voiceKind: null as never, voiceChannelId: null as never };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["join", "leave"]);
	});
});

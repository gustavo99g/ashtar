import { act, render } from "@testing-library/react";
import { EventEmitter } from "events";
import { RoomEvent } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings";
import { useMaybeVoice } from "@/features/voice";
import { RoomSounds } from "../components/RoomSounds";
import {
	playPttSound,
	playRoomSound,
	RETRY_MS,
	resetRoomSounds,
} from "../model/roomSounds";

vi.mock("@/features/voice", () => ({ useMaybeVoice: vi.fn() }));

const played: string[] = [];
const audios: { volume: number }[] = [];

beforeEach(() => {
	played.length = 0;
	audios.length = 0;
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
			ptt: false,
		},
		soundVolume: 100,
	});
	localStorage.clear();
	vi.stubGlobal(
		"Audio",
		class {
			volume = 1;
			constructor(src: string) {
				played.push(src.split("/").pop() ?? src);
				audios.push(this);
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

		// Surdo, os outros entrando e transmitindo não tocam.
		played.length = 0;
		resetRoomSounds();
		act(() => {
			room.emit(RoomEvent.ParticipantConnected, { identity: "bia" });
			room.emit(RoomEvent.ParticipantConnected, { identity: "bia:screen" });
		});
		await flush();
		expect(names()).toEqual([]);

		// Trocar de sala: o de sair no clique, o de entrar quando a nova conecta, mesmo logo depois
		// de outro (trocar rápido).
		played.length = 0;
		voice = { ...voice, voiceChannelId: "squad", connectionState: "connecting", room: null };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["leave"]);
		voice = { ...voice, connectionState: "connected", room };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["leave", "join"]);

		voice = { ...voice, voiceKind: null as never, voiceChannelId: null as never };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["leave", "join", "leave"]);
	});

	it("o de entrar espera a sala ficar pronta, e o som que não toca tenta de novo", async () => {
		const room = Object.assign(new EventEmitter(), {
			localParticipant: { identity: "kid" },
		});
		let voice = {
			voiceKind: "room",
			voiceChannelId: "sala",
			connectionState: "connected",
			room: null as unknown,
			isMuted: false,
			isDeafened: false,
		};
		vi.mocked(useMaybeVoice).mockImplementation(() => voice as never);
		// O primeiro play falha (a saída mudando), o segundo toca.
		let fails = 1;
		vi.stubGlobal(
			"Audio",
			class {
				volume = 1;
				constructor(src: string) {
					audios.push(this);
					this.src = src;
				}
				src: string;
				play() {
					if (fails-- > 0) return Promise.reject(new Error("NotAllowed"));
					played.push(this.src.split("/").pop() ?? this.src);
					return Promise.resolve();
				}
			},
		);
		vi.useFakeTimers();
		const { rerender } = render(<RoomSounds />);
		// Conectada, mas o microfone ainda abrindo: nada ainda.
		await flush();
		expect(audios).toHaveLength(0);

		voice = { ...voice, room };
		rerender(<RoomSounds />);
		await flush();
		expect(audios).toHaveLength(1);
		expect(names()).toEqual([]);
		await act(async () => {
			vi.advanceTimersByTime(RETRY_MS);
			await Promise.resolve();
		});
		await flush();
		vi.useRealTimers();
		expect(names()).toEqual(["join"]);
	});

	it("mutar e ficar surdo fora da voz também tocam, e numa ligação não", async () => {
		let voice = {
			voiceKind: null as string | null,
			voiceChannelId: null as string | null,
			connectionState: "disconnected",
			room: null,
			isMuted: false,
			isDeafened: false,
		};
		vi.mocked(useMaybeVoice).mockImplementation(() => voice as never);
		const { rerender } = render(<RoomSounds />);
		voice = { ...voice, isMuted: true };
		rerender(<RoomSounds />);
		voice = { ...voice, isDeafened: true };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["mute", "deafen"]);

		// Mutar e desmutar rápido toca todas as vezes.
		played.length = 0;
		voice = { ...voice, isDeafened: false, isMuted: false };
		rerender(<RoomSounds />);
		voice = { ...voice, isMuted: true };
		rerender(<RoomSounds />);
		voice = { ...voice, isMuted: false };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual(["undeafen", "mute", "unmute"]);

		played.length = 0;
		voice = {
			...voice,
			voiceKind: "call",
			voiceChannelId: "dm",
			connectionState: "connected",
		};
		rerender(<RoomSounds />);
		voice = { ...voice, isDeafened: false };
		rerender(<RoomSounds />);
		await flush();
		expect(names()).toEqual([]);
	});
});

describe("o pressionar para falar e o volume dos sons", () => {
	it("o clique só toca com a chave ligada, ao abrir e ao fechar, sem intervalo", () => {
		playPttSound(true);
		expect(played).toEqual([]);

		useSettingsStore.setState((state) => ({
			roomSounds: { ...state.roomSounds, ptt: true },
		}));
		playPttSound(true);
		playPttSound(false);
		playPttSound(true);

		expect(played).toEqual(["ptt-on.wav", "ptt-off.wav", "ptt-on.wav"]);
	});

	it("todo som sai no volume da régua de Notificações", () => {
		useSettingsStore.getState().setSoundVolume(40);

		playRoomSound("join", { now: 1 });

		expect(audios[0].volume).toBeCloseTo(0.4);
	});
});

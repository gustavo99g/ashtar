import { act, render, screen } from "@testing-library/react";
import { DisconnectReason, RoomEvent, Track } from "livekit-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GIVE_UP_MS } from "../model/reconnect";
import { useSessionStore } from "@/features/identity";
import {
	ApiError,
	createVoiceToken,
	getMe,
	TIMEOUT_MESSAGE,
	type UserView,
} from "@/lib/api";
import { applyInputChain } from "../../input/chain";
import { DEFAULT_INPUT, useInputChoice } from "../../input/stores/inputStore";
const SALA = { id: "sala" } as const;
import { useVoice } from "../hooks/useVoice";
import { VoiceProvider } from "../components/VoiceProvider";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createVoiceToken: vi.fn(),
	getMe: vi.fn(),
}));

vi.mock("../../input/chain", () => ({
	applyInputChain: vi.fn(() => Promise.resolve()),
}));

/** As salas criadas pelo `VoiceProvider`, com as opções que receberam e o que dispara os eventos. */
const rooms = vi.hoisted(
	() =>
		[] as {
			options: { audioCaptureDefaults?: Record<string, unknown> };
			emit: (event: string, ...args: unknown[]) => void;
		}[],
);

// Uma sala de mentira: guarda as escutas, e a conexão nunca termina (o teste não sobe um LiveKit).
vi.mock("livekit-client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("livekit-client")>();
	class FakeRoom {
		private listeners = new Map<string, ((...args: unknown[]) => void)[]>();
		remoteParticipants = new Map();
		options: { audioCaptureDefaults?: Record<string, unknown> };
		constructor(options: { audioCaptureDefaults?: Record<string, unknown> } = {}) {
			this.options = options;
			rooms.push(this);
		}
		on(event: string, listener: (...args: unknown[]) => void) {
			this.listeners.set(event, [
				...(this.listeners.get(event) ?? []),
				listener,
			]);
			return this;
		}
		emit(event: string, ...args: unknown[]) {
			for (const listener of this.listeners.get(event) ?? []) listener(...args);
		}
		removeAllListeners() {
			this.listeners.clear();
			return this;
		}
		connect() {
			return new Promise(() => {});
		}
		disconnect() {
			return Promise.resolve();
		}
	}
	return { ...actual, Room: FakeRoom };
});

const user: UserView = {
	id: "u1",
	nick: "kid",
	display_name: null,
	is_owner: false,
};

/** Mostra o estado da voz e entra na sala ao clicar. */
function Probe() {
	const { voiceChannelId, connectionState, join } = useVoice();
	return (
		<button type="button" onClick={() => join(SALA.id)}>
			{voiceChannelId ?? "fora"} {connectionState}
		</button>
	);
}

afterEach(() => {
	vi.mocked(createVoiceToken).mockReset();
	vi.mocked(getMe).mockReset();
	rooms.length = 0;
	vi.mocked(applyInputChain).mockClear();
	useInputChoice.setState(DEFAULT_INPUT);
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("VoiceProvider", () => {
	it("pede o token da sessão e sai da sala quando a sessão cai", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		// O token nunca chega: o teste para antes de conectar no LiveKit.
		vi.mocked(createVoiceToken).mockReturnValue(new Promise(() => {}));
		render(
			<VoiceProvider>
				<Probe />
			</VoiceProvider>,
		);

		await act(async () => screen.getByRole("button").click());

		expect(createVoiceToken).toHaveBeenCalledWith(SALA.id);
		expect(screen.getByRole("button")).toHaveTextContent(
			`${SALA.id} connecting`,
		);

		act(() =>
			useSessionStore.setState({
				session: { status: "leftGroup", account: null },
			}),
		);

		expect(screen.getByRole("button")).toHaveTextContent("fora disconnected");
	});

	it("a sala nasce sem processador nas opções; a cadeia do microfone entra quando ele é publicado", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(createVoiceToken).mockReturnValue(new Promise(() => {}));
		render(
			<VoiceProvider>
				<Probe />
			</VoiceProvider>,
		);
		await act(async () => screen.getByRole("button").click());
		const room = rooms[rooms.length - 1];

		// Pelas opções, o LiveKit aplicaria o processador antes de a trilha ter o AudioContext e
		// recusaria: "Audio context needs to be set on LocalAudioTrack".
		expect(room.options.audioCaptureDefaults?.processor).toBeUndefined();

		act(() =>
			room.emit(RoomEvent.LocalTrackPublished, { source: Track.Source.Camera }),
		);
		expect(applyInputChain).not.toHaveBeenCalled();

		act(() =>
			room.emit(RoomEvent.LocalTrackPublished, {
				source: Track.Source.Microphone,
			}),
		);
		expect(applyInputChain).toHaveBeenCalledWith(
			room,
			expect.objectContaining({ suppression: true, volume: 100, mode: "voice" }),
		);
	});

	it("com a supressão desligada, o microfone publicado pede a cadeia sem o RNNoise", async () => {
		useInputChoice.setState({ ...DEFAULT_INPUT, suppression: false });
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(createVoiceToken).mockReturnValue(new Promise(() => {}));
		render(
			<VoiceProvider>
				<Probe />
			</VoiceProvider>,
		);
		await act(async () => screen.getByRole("button").click());
		const room = rooms[rooms.length - 1];

		act(() =>
			room.emit(RoomEvent.LocalTrackPublished, {
				source: Track.Source.Microphone,
			}),
		);

		expect(applyInputChain).toHaveBeenCalledWith(
			room,
			expect.objectContaining({ suppression: false }),
		);
	});

	it("um erro ao pedir o token fica no estado, e entrar de novo tenta outra vez", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(createVoiceToken).mockRejectedValueOnce(new Error("sem rede"));
		render(
			<VoiceProvider>
				<Probe />
			</VoiceProvider>,
		);

		await act(async () => screen.getByRole("button").click());
		expect(screen.getByRole("button")).toHaveTextContent(`${SALA.id} error`);

		vi.mocked(createVoiceToken).mockReturnValue(new Promise(() => {}));
		await act(async () => screen.getByRole("button").click());

		expect(createVoiceToken).toHaveBeenCalledTimes(2);
		expect(screen.getByRole("button")).toHaveTextContent(
			`${SALA.id} connecting`,
		);
	});

	it("a API que não responde em 10 s vira erro com a mensagem do tempo limite, e não um conectando sem fim", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(createVoiceToken).mockRejectedValueOnce(
			new ApiError({ status: 0, kind: "timeout", message: TIMEOUT_MESSAGE }),
		);
		function ErrorProbe() {
			const { connectionState, error, join } = useVoice();
			return (
				<button type="button" onClick={() => join(SALA.id)}>
					{connectionState}: {error?.message}
				</button>
			);
		}
		render(
			<VoiceProvider>
				<ErrorProbe />
			</VoiceProvider>,
		);

		await act(async () => screen.getByRole("button").click());

		expect(screen.getByRole("button")).toHaveTextContent(
			`error: ${TIMEOUT_MESSAGE}`,
		);
	});

	it("tirado da sala pela API, confere a sessão na hora", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(createVoiceToken).mockResolvedValue({
			url: "wss://lk.test",
			token: "t",
		});
		vi.mocked(getMe).mockReturnValue(new Promise(() => {}));
		render(
			<VoiceProvider>
				<Probe />
			</VoiceProvider>,
		);
		await act(async () => screen.getByRole("button").click());
		const room = rooms[rooms.length - 1];

		// A conexão caiu por outro motivo: só a tela de "caiu", sem perguntar nada à API.
		act(() =>
			room?.emit(RoomEvent.Disconnected, DisconnectReason.SERVER_SHUTDOWN),
		);
		expect(getMe).not.toHaveBeenCalled();

		act(() =>
			room?.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED),
		);
		expect(getMe).toHaveBeenCalledTimes(1);
	});
});

describe("a voz volta sozinha", () => {
	function ErrorProbe() {
		const { voiceChannelId, connectionState, error, join, leave } = useVoice();
		return (
			<>
				<button type="button" onClick={() => join(SALA.id)}>
					{voiceChannelId ?? "fora"} {connectionState}: {error?.message}
				</button>
				<button type="button" onClick={leave}>
					sair
				</button>
			</>
		);
	}

	async function enter() {
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(createVoiceToken).mockResolvedValue({
			url: "wss://lk.test",
			token: "t",
		});
		render(
			<VoiceProvider>
				<ErrorProbe />
			</VoiceProvider>,
		);
		await act(async () => screen.getAllByRole("button")[0].click());
		return rooms[rooms.length - 1];
	}

	const state = () => screen.getAllByRole("button")[0];

	afterEach(() => {
		vi.useRealTimers();
	});

	it("uma queda que ninguém pediu fica reconectando e entra de novo, com um token novo", async () => {
		vi.useFakeTimers();
		const room = await enter();
		expect(createVoiceToken).toHaveBeenCalledTimes(1);

		act(() =>
			room.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE),
		);
		expect(state()).toHaveTextContent(`${SALA.id} reconnecting`);

		await act(async () => vi.advanceTimersByTimeAsync(1_000));

		expect(createVoiceToken).toHaveBeenCalledTimes(2);
		expect(rooms.length).toBe(2);
		expect(state()).toHaveTextContent(`${SALA.id} reconnecting`);
	});

	it("uma tentativa que falha agenda a próxima, esperando mais", async () => {
		vi.useFakeTimers();
		const room = await enter();
		vi.mocked(createVoiceToken).mockRejectedValue(new Error("sem rede"));

		act(() =>
			room.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE),
		);
		await act(async () => vi.advanceTimersByTimeAsync(1_000));
		expect(createVoiceToken).toHaveBeenCalledTimes(2);
		expect(state()).toHaveTextContent(`${SALA.id} reconnecting`);

		await act(async () => vi.advanceTimersByTimeAsync(1_999));
		expect(createVoiceToken).toHaveBeenCalledTimes(2);
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(createVoiceToken).toHaveBeenCalledTimes(3);
	});

	it("depois de 5 minutos, desiste e fica o erro", async () => {
		vi.useFakeTimers();
		const room = await enter();
		vi.mocked(createVoiceToken).mockRejectedValue(new Error("sem rede"));

		act(() =>
			room.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE),
		);
		await act(async () => vi.advanceTimersByTimeAsync(GIVE_UP_MS + 30_000));

		expect(state()).toHaveTextContent(
			`${SALA.id} error: A conexão com a sala caiu e não voltou.`,
		);
		const calls = vi.mocked(createVoiceToken).mock.calls.length;
		await act(async () => vi.advanceTimersByTimeAsync(60_000));
		expect(createVoiceToken).toHaveBeenCalledTimes(calls);
	});

	it("sair no meio da volta cancela as tentativas", async () => {
		vi.useFakeTimers();
		const room = await enter();
		act(() =>
			room.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE),
		);

		await act(async () => screen.getByRole("button", { name: "sair" }).click());
		await act(async () => vi.advanceTimersByTimeAsync(60_000));

		expect(createVoiceToken).toHaveBeenCalledTimes(1);
		expect(state()).toHaveTextContent("fora disconnected");
	});

	it("tirada pela API, não volta", async () => {
		vi.useFakeTimers();
		vi.mocked(getMe).mockReturnValue(new Promise(() => {}));
		const room = await enter();

		act(() =>
			room.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED),
		);
		await act(async () => vi.advanceTimersByTimeAsync(60_000));

		expect(createVoiceToken).toHaveBeenCalledTimes(1);
		expect(state()).not.toHaveTextContent("reconnecting");
	});
});

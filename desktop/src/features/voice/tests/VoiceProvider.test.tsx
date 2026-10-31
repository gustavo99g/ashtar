import { act, render, screen } from "@testing-library/react";
import { DisconnectReason, RoomEvent } from "livekit-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { createVoiceToken, getMe, type UserView } from "@/lib/api";
import { SALA } from "../channel";
import { useVoice } from "../useVoice";
import { VoiceProvider } from "../VoiceProvider";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createVoiceToken: vi.fn(),
	getMe: vi.fn(),
}));

/** As salas criadas pelo `VoiceProvider`, para o teste disparar os eventos delas. */
const rooms = vi.hoisted(
	() => [] as { emit: (event: string, ...args: unknown[]) => void }[],
);

// Uma sala de mentira: guarda as escutas, e a conexão nunca termina (o teste não sobe um LiveKit).
vi.mock("livekit-client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("livekit-client")>();
	class FakeRoom {
		private listeners = new Map<string, ((...args: unknown[]) => void)[]>();
		remoteParticipants = new Map();
		constructor() {
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

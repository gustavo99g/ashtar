import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMyStatus } from "@/features/identity";
import { stopWatching, useVoice } from "@/features/voice";
import { acceptCall, hangUpCall } from "@/lib/api";
import {
	notificationRing,
	onNotificationAnswer,
} from "@/lib/tauri/commands";
import { CallBridge } from "../components/CallBridge";
import {
	applyCall,
	applyEnded,
	applyReady,
	resetCalls,
	useCallStore,
} from "../stores/callStore";
import { callView } from "./fixtures";

vi.mock("@/features/voice", () => ({
	useVoice: vi.fn(),
	stopWatching: vi.fn(),
}));
vi.mock("@/features/identity", () => ({ useMyStatus: vi.fn() }));
vi.mock("@/features/screen-share", () => ({
	useScreenShareState: () => ({ status: "idle" }),
}));
vi.mock("@/lib/api", () => ({
	acceptCall: vi.fn(),
	hangUpCall: vi.fn(() => Promise.resolve()),
	startCall: vi.fn(),
}));
vi.mock("@/lib/tauri/commands", () => ({
	notificationRing: vi.fn(() => Promise.resolve()),
	onNotificationAnswer: vi.fn(() => Promise.resolve(() => {})),
}));

const join = vi.fn();
const leave = vi.fn();

/** A voz de agora; o `rerender` do teste troca. */
function voice(overrides: Partial<ReturnType<typeof useVoice>> = {}) {
	vi.mocked(useVoice).mockReturnValue({
		voiceChannelId: null,
		voiceKind: null,
		voiceTitle: null,
		connectionState: "disconnected",
		screenShare: null,
		join,
		leave,
		...overrides,
	} as unknown as ReturnType<typeof useVoice>);
}

function Where() {
	return <p data-testid="where">{useLocation().pathname}</p>;
}

const showConversation = vi.fn();

function ui() {
	return (
		<MemoryRouter initialEntries={["/server"]}>
			<CallBridge showConversation={showConversation} />
			<Where />
		</MemoryRouter>
	);
}

describe("a ponte das ligações", () => {
	beforeEach(() => {
		resetCalls();
		vi.clearAllMocks();
		vi.mocked(useMyStatus).mockReturnValue("available");
		voice();
	});

	it("atendida, sai da sala, entra na da conversa e abre a tela da ligação", () => {
		voice({ voiceChannelId: "sala", voiceKind: "room" });
		applyReady("ana", null);
		const view = render(ui());
		act(() =>
			applyCall(callView({ outcome: "answered", answered_at: 1_010 })),
		);
		expect(stopWatching).toHaveBeenCalled();
		expect(join).toHaveBeenCalledWith("d1", { kind: "call", title: "Kid" });
		expect(useCallStore.getState().returnRoom).toBe("sala");
		expect(screen.getByTestId("where")).toHaveTextContent("/room");

		// A voz entrou: em ligação.
		voice({
			voiceChannelId: "d1",
			voiceKind: "call",
			connectionState: "connected",
		});
		view.rerender(ui());
		expect(useCallStore.getState().phase).toBe("in_call");
		expect(hangUpCall).not.toHaveBeenCalled();

		// Saiu da sala da ligação (Desligar): a ligação acaba para os dois.
		voice();
		view.rerender(ui());
		expect(hangUpCall).toHaveBeenCalledWith("d1", "end");
	});

	it("o fim do outro lado tira a voz da sala e abre a conversa", () => {
		applyReady("ana", null);
		voice({ voiceChannelId: "d1", voiceKind: "call", connectionState: "connected" });
		act(() =>
			applyCall(callView({ outcome: "answered", answered_at: 1_010 })),
		);
		render(ui());
		act(() =>
			applyEnded({
				call_id: "c1",
				channel_id: "d1",
				outcome: "answered",
				duration: 30,
			}),
		);
		expect(leave).toHaveBeenCalled();
		expect(showConversation).toHaveBeenCalledWith("d1");
		expect(hangUpCall).not.toHaveBeenCalled();
	});

	it("tocando, manda o cartão para a janela dos avisos; em Ocupado, não", () => {
		applyReady("ana", null);
		const view = render(ui());
		act(() => applyCall(callView()));
		expect(notificationRing).toHaveBeenLastCalledWith({
			callId: "c1",
			channelId: "d1",
			person: { nick: "kid", displayName: "Kid" },
			inRoom: false,
			sharing: false,
		});

		vi.mocked(useMyStatus).mockReturnValue("busy");
		view.rerender(ui());
		expect(notificationRing).toHaveBeenLastCalledWith(null);
	});

	it("o Atender do cartão atende; o Responder com mensagem recusa e abre a conversa", async () => {
		let answer: (value: unknown) => void = () => {};
		vi.mocked(onNotificationAnswer).mockImplementation((callback) => {
			answer = callback;
			return Promise.resolve(() => {});
		});
		vi.mocked(acceptCall).mockResolvedValue(
			callView({ outcome: "answered", answered_at: 1_010 }),
		);
		applyReady("ana", null);
		render(ui());
		act(() => applyCall(callView()));

		await act(async () => answer({ callId: "c1", action: "accept" }));
		expect(acceptCall).toHaveBeenCalledWith("d1");

		resetCalls();
		applyReady("ana", null);
		act(() => applyCall(callView({ id: "c2" })));
		await act(async () => answer({ callId: "c2", action: "reply" }));
		expect(showConversation).toHaveBeenCalledWith("d1");
		expect(hangUpCall).toHaveBeenCalledWith("d1", "decline");

		// A resposta de uma ligação que já não é esta não faz nada.
		vi.mocked(hangUpCall).mockClear();
		await act(async () => answer({ callId: "velha", action: "decline" }));
		expect(hangUpCall).not.toHaveBeenCalled();
	});
});

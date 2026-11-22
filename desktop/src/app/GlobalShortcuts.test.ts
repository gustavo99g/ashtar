import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptRinging, declineOrHangUp } from "@/features/calls";
import { playPttSound } from "@/features/notifications";
import {
	setPushToTalkHeld,
	useInputChoice,
	type VoiceContextValue,
} from "@/features/voice";
import { handleShortcut } from "./GlobalShortcuts";

vi.mock("@/features/calls", () => ({
	acceptRinging: vi.fn(async () => {}),
	declineOrHangUp: vi.fn(async () => {}),
	runCallAction: (action: () => Promise<void>) => void action(),
}));
vi.mock("@/features/notifications", () => ({ playPttSound: vi.fn() }));
vi.mock("@/features/voice", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/features/voice")>()),
	setPushToTalkHeld: vi.fn(),
}));

function voice(patch: Partial<VoiceContextValue> = {}): VoiceContextValue {
	return {
		room: {},
		isMuted: false,
		isDeafened: false,
		mute: vi.fn(async () => {}),
		unmute: vi.fn(async () => {}),
		deafen: vi.fn(async () => {}),
		undeafen: vi.fn(async () => {}),
		...patch,
	} as unknown as VoiceContextValue;
}

beforeEach(() => {
	vi.clearAllMocks();
	useInputChoice.setState({ mode: "voice" });
});

describe("os atalhos globais", () => {
	it("desativar microfone e áudio alternam, só ao apertar", () => {
		const v = voice();
		handleShortcut("mute", true, v);
		handleShortcut("mute", false, v);
		expect(v.mute).toHaveBeenCalledTimes(1);

		const muted = voice({ isMuted: true, isDeafened: true });
		handleShortcut("mute", true, muted);
		handleShortcut("deafen", true, muted);
		expect(muted.unmute).toHaveBeenCalled();
		expect(muted.undeafen).toHaveBeenCalled();
	});

	it("o pressionar para falar abre e fecha o portão, com o clique só no modo dele", () => {
		const v = voice();
		handleShortcut("ptt", true, v);
		expect(setPushToTalkHeld).toHaveBeenLastCalledWith(true);
		expect(playPttSound).not.toHaveBeenCalled();

		useInputChoice.setState({ mode: "ptt" });
		handleShortcut("ptt", true, v);
		handleShortcut("ptt", false, v);
		expect(setPushToTalkHeld).toHaveBeenLastCalledWith(false);
		expect(playPttSound).toHaveBeenCalledTimes(2);

		// Mutado, o portão abre por baixo, mas não faz sentido o clique.
		handleShortcut("ptt", true, voice({ isMuted: true }));
		expect(playPttSound).toHaveBeenCalledTimes(2);
	});

	it("atender e recusar vão para a ligação", () => {
		handleShortcut("answer", true, voice());
		handleShortcut("decline", true, voice());
		expect(acceptRinging).toHaveBeenCalled();
		expect(declineOrHangUp).toHaveBeenCalled();
	});
});

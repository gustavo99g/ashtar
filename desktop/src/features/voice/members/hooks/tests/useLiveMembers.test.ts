import { useParticipants } from "@livekit/components-react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useVoice } from "@/features/voice/room/hooks/useVoice";
import { useLiveMembers } from "../useLiveMembers";

vi.mock("@livekit/components-react", () => ({ useParticipants: vi.fn() }));
vi.mock("@/features/voice/room/hooks/useVoice", () => ({ useVoice: vi.fn() }));

function participant(identity: string, sharing = false, isLocal = false) {
	return {
		identity,
		name: identity,
		metadata: undefined,
		isLocal,
		isScreenShareEnabled: sharing,
		isSpeaking: false,
		isMicrophoneEnabled: true,
	};
}

describe("useLiveMembers", () => {
	it("a tela de alguém não é membro: só marca o dono como transmitindo", () => {
		vi.mocked(useVoice).mockReturnValue({
			isDeafened: false,
			deafenedIds: new Set(),
		} as never);
		vi.mocked(useParticipants).mockReturnValue([
			participant("eu", false, true),
			participant("juju"),
			participant("juju:screen", true),
			// Entrou, mas ainda não publicou a tela.
			participant("eu:screen", false),
		] as never);

		const { result } = renderHook(() => useLiveMembers());

		expect(result.current.map((m) => [m.id, m.sharing])).toEqual([
			["eu", false],
			["juju", true],
		]);
	});
});

import { useTracks } from "@livekit/components-react";
import { renderHook } from "@testing-library/react";
import { Track } from "livekit-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenShareState } from "../hooks/useScreenShareState";
import { useShareButton } from "../hooks/useShareButton";
import type { ScreenShareController } from "../model/controller";
import { shareTrackName } from "../model/shareInfo";
import { usePickerStore } from "../stores/pickerStore";

vi.mock("@livekit/components-react", () => ({
	useTracks: vi.fn(),
	useRoomContext: () => ({ localParticipant: { identity: "u1" } }),
}));
vi.mock("../hooks/useScreenShareState", () => ({
	useScreenShareState: vi.fn(),
}));

const controller = { stop: vi.fn() } as unknown as ScreenShareController;

/**
 * Uma publicação de tela da `:screen` de `owner` (ADR 0017), que começou em `startedAt`. A
 * `:screen`, mesmo a minha, é um participante remoto para o WebView.
 */
function share(owner: string, startedAt = 1_000) {
	return {
		participant: { identity: `${owner}:screen`, isLocal: false, name: owner },
		publication: {
			trackName: shareTrackName({
				startedAt,
				quality: "1080p60",
				title: "Jogo",
			}),
		},
	};
}

beforeEach(() => {
	vi.mocked(useTracks).mockReset();
	vi.mocked(useScreenShareState).mockReturnValue({ status: "idle" });
	vi.mocked(controller.stop).mockReset();
	usePickerStore.setState({ open: false });
});

describe("useShareButton: uma transmissão por vez", () => {
	it("olha as publicações de tela da sala, assinadas ou não", () => {
		vi.mocked(useTracks).mockReturnValue([]);

		renderHook(() => useShareButton(controller));

		// A sala só assina a tela de quem está no palco do Foco: sem isto a trava ficaria cega.
		expect(useTracks).toHaveBeenCalledWith([Track.Source.ScreenShare], {
			onlySubscribed: false,
		});
	});

	it("com outra pessoa transmitindo, diz quem é e não abre o seletor", () => {
		vi.mocked(useTracks).mockReturnValue([share("u2")] as never);

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(result.current.busyWith).toMatchObject({ id: "u2", name: "u2" });
		expect(usePickerStore.getState().open).toBe(false);
	});

	it("a própria publicação não conta como ocupada", () => {
		vi.mocked(useTracks).mockReturnValue([share("u1")] as never);

		const { result } = renderHook(() => useShareButton(controller));

		expect(result.current.busyWith).toBeNull();
	});

	it("com duas transmissões, quem começou antes é quem vale", () => {
		const mine = share("u1", 2_000);
		const earlier = share("u2", 1_000);
		vi.mocked(useTracks).mockReturnValue([mine, earlier] as never);

		const { result } = renderHook(() => useShareButton(controller));

		expect(result.current.busyWith?.id).toBe("u2");
	});

	it("sem transmissão, o clique abre o seletor", () => {
		vi.mocked(useTracks).mockReturnValue([]);

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(usePickerStore.getState().open).toBe(true);
	});

	it("transmitindo, o clique não para nem abre o seletor: abre os ajustes", () => {
		vi.mocked(useScreenShareState).mockReturnValue({
			status: "active",
			sessionId: 1,
			startedAt: 0,
			paused: true,
		} as never);
		vi.mocked(useTracks).mockReturnValue([share("u1")] as never);

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(result.current.paused).toBe(true);
		expect(controller.stop).not.toHaveBeenCalled();
		expect(usePickerStore.getState().open).toBe(false);
	});
});

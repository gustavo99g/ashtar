import { useTracks } from "@livekit/components-react";
import { renderHook } from "@testing-library/react";
import { Track } from "livekit-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenShareController } from "../controller";
import { usePickerStore } from "../pickerStore";
import { shareTrackName } from "../shareInfo";
import { useScreenShareState } from "../useScreenShareState";
import { useShareButton } from "../useShareButton";

vi.mock("@livekit/components-react", () => ({ useTracks: vi.fn() }));
vi.mock("../useScreenShareState", () => ({ useScreenShareState: vi.fn() }));

const controller = { stop: vi.fn() } as unknown as ScreenShareController;

/** Uma publicação de tela de `identity`, que começou em `startedAt`. */
function share(identity: string, local: boolean, startedAt = 1_000) {
	return {
		participant: { identity, isLocal: local },
		publication: {
			trackName: shareTrackName({
				startedAt,
				quality: "720p60",
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
		const other = share("u2", false);
		vi.mocked(useTracks).mockReturnValue([other] as never);

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(result.current.busyWith).toBe(other.participant);
		expect(usePickerStore.getState().open).toBe(false);
	});

	it("a própria publicação não conta como ocupada", () => {
		vi.mocked(useTracks).mockReturnValue([share("u1", true)] as never);

		const { result } = renderHook(() => useShareButton(controller));

		expect(result.current.busyWith).toBeNull();
	});

	it("com duas transmissões, quem começou antes é quem vale", () => {
		const mine = share("u1", true, 2_000);
		const earlier = share("u2", false, 1_000);
		vi.mocked(useTracks).mockReturnValue([mine, earlier] as never);

		const { result } = renderHook(() => useShareButton(controller));

		expect(result.current.busyWith).toBe(earlier.participant);
	});

	it("sem transmissão, o clique abre o seletor", () => {
		vi.mocked(useTracks).mockReturnValue([]);

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(usePickerStore.getState().open).toBe(true);
	});

	it("transmitindo, o clique para a transmissão", () => {
		vi.mocked(useScreenShareState).mockReturnValue({
			status: "active",
			sessionId: 1,
		} as never);
		vi.mocked(useTracks).mockReturnValue([share("u1", true)] as never);

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(controller.stop).toHaveBeenCalledOnce();
		expect(usePickerStore.getState().open).toBe(false);
	});
});

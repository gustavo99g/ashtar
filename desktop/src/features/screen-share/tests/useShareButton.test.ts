import { useTracks } from "@livekit/components-react";
import { renderHook } from "@testing-library/react";
import { Track } from "livekit-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenShareController } from "../controller";
import { usePickerStore } from "../pickerStore";
import { useShareButton } from "../useShareButton";

vi.mock("@livekit/components-react", () => ({ useTracks: vi.fn() }));
vi.mock("../useScreenShareState", () => ({
	useScreenShareState: vi.fn(() => ({ status: "idle" })),
}));

const controller = {} as ScreenShareController;

/** Uma publicação de tela, de quem é `local` ou de outra pessoa. */
function share(local: boolean) {
	return { participant: { isLocal: local } };
}

beforeEach(() => {
	vi.mocked(useTracks).mockReset();
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

	it("com outra pessoa transmitindo, o botão fica desligado", () => {
		vi.mocked(useTracks).mockReturnValue([share(false)] as never);

		const { result } = renderHook(() => useShareButton(controller));

		expect(result.current.disabled).toBe(true);
	});

	it("a própria transmissão não trava o botão", () => {
		vi.mocked(useTracks).mockReturnValue([share(true)] as never);

		const { result } = renderHook(() => useShareButton(controller));

		expect(result.current.disabled).toBe(false);
	});

	it("sem transmissão, o clique abre o seletor", () => {
		vi.mocked(useTracks).mockReturnValue([]);

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(usePickerStore.getState().open).toBe(true);
	});
});

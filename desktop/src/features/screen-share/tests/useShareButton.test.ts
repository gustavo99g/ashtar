import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenShareState } from "../hooks/useScreenShareState";
import { useShareButton } from "../hooks/useShareButton";
import type { ScreenShareController } from "../model/controller";
import { usePickerStore } from "../stores/pickerStore";

vi.mock("../hooks/useScreenShareState", () => ({
	useScreenShareState: vi.fn(),
}));

const controller = { stop: vi.fn() } as unknown as ScreenShareController;

beforeEach(() => {
	vi.mocked(useScreenShareState).mockReturnValue({ status: "idle" });
	vi.mocked(controller.stop).mockReset();
	usePickerStore.setState({ open: false });
});

describe("useShareButton: várias transmissões ao mesmo tempo", () => {
	it("sem transmitir, o clique abre o seletor, mesmo com outras pessoas transmitindo", () => {
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

		const { result } = renderHook(() => useShareButton(controller));
		result.current.onClick();

		expect(result.current.paused).toBe(true);
		expect(controller.stop).not.toHaveBeenCalled();
		expect(usePickerStore.getState().open).toBe(false);
	});

	it("começando, o botão fica travado até a transmissão sair", () => {
		vi.mocked(useScreenShareState).mockReturnValue({
			status: "starting",
		} as never);

		const { result } = renderHook(() => useShareButton(controller));

		expect(result.current.starting).toBe(true);
	});
});

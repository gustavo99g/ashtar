import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScreenShares } from "@/features/screen-share";
import { REWATCH_MS, WatchJanitor } from "../components/WatchJanitor";
import { useRoomView, watchShare } from "../stores/roomViewStore";

vi.mock("@/features/screen-share", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useScreenShares: vi.fn(),
}));

function live(...owners: string[]) {
	vi.mocked(useScreenShares).mockReturnValue(
		owners.map((ownerId) => ({ ownerId, isOwn: false })) as never,
	);
}

afterEach(() => {
	vi.useRealTimers();
	useRoomView.setState({ watching: [], focused: null, miniPick: null });
});

describe("WatchJanitor", () => {
	it("fecha a que acabou e reabre, em foco, se ela voltar logo", () => {
		live("ana");
		const { rerender } = render(<WatchJanitor />);
		act(() => {
			watchShare("ana");
			useRoomView.setState({ focused: "ana" });
		});

		live();
		rerender(<WatchJanitor />);
		expect(useRoomView.getState().watching).toEqual([]);

		live("ana");
		rerender(<WatchJanitor />);
		expect(useRoomView.getState().watching).toEqual(["ana"]);
		expect(useRoomView.getState().focused).toBe("ana");
	});

	it("voltando depois do prazo, fica fechada", () => {
		vi.useFakeTimers();
		live("ana");
		const { rerender } = render(<WatchJanitor />);
		act(() => watchShare("ana"));
		live();
		rerender(<WatchJanitor />);

		vi.advanceTimersByTime(REWATCH_MS + 1);
		live("ana");
		rerender(<WatchJanitor />);
		expect(useRoomView.getState().watching).toEqual([]);
	});
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchWindowMinimized } from "../tauri/window";
import { useAppVisible } from "../visibility";

vi.mock("../tauri/window", () => ({
	watchWindowMinimized: vi.fn(() => () => {}),
}));

function setPageVisibility(state: DocumentVisibilityState) {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: state,
	});
	document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
	setPageVisibility("visible");
	vi.mocked(watchWindowMinimized).mockClear();
});

describe("useAppVisible", () => {
	it("acompanha a visibilidade da página", () => {
		const { result } = renderHook(() => useAppVisible());
		expect(result.current).toBe(true);

		act(() => setPageVisibility("hidden"));
		expect(result.current).toBe(false);

		act(() => setPageVisibility("visible"));
		expect(result.current).toBe(true);
	});

	it("a janela minimizada conta como fora de vista, mesmo com a página visível", () => {
		const { result } = renderHook(() => useAppVisible());
		const onMinimized = vi.mocked(watchWindowMinimized).mock.calls[0][0];

		act(() => onMinimized(true));
		expect(result.current).toBe(false);

		act(() => onMinimized(false));
		expect(result.current).toBe(true);
	});
});

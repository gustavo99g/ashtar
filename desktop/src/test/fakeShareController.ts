/** Um `ScreenShareController` de mentira para os testes, parado em `state`. */
import { vi } from "vitest";
import type {
	ScreenShareController,
	ScreenShareState,
} from "@/features/screen-share";
import type { CaptureSource, ShareStats } from "@/lib/tauri/commands";

export function fakeShareController(
	state: ScreenShareState = { status: "idle" },
	sources: CaptureSource[] = [],
) {
	return {
		getState: () => state,
		onStateChange: () => () => {},
		getStats: (): ShareStats | null => null,
		onStats: () => () => {},
		listSources: vi.fn(async () => sources),
		start: vi.fn(async () => {}),
		update: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
		dispose: async () => {},
	} satisfies ScreenShareController;
}

import { useCallback, useSyncExternalStore } from "react";
import type { ShareStats } from "@/lib/tauri/commands";
import type { ScreenShareController } from "../model/controller";

const noop = () => {};

/** Os números do último segundo da transmissão, ou `null` fora de uma. */
export function useShareStats(
	controller: ScreenShareController | null,
): ShareStats | null {
	const subscribe = useCallback(
		(onChange: () => void) =>
			controller ? controller.onStats(onChange) : noop,
		[controller],
	);
	const getSnapshot = useCallback(
		() => controller?.getStats() ?? null,
		[controller],
	);
	return useSyncExternalStore(subscribe, getSnapshot);
}

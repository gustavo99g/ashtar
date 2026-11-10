import { useCallback, useSyncExternalStore } from "react";
import type { ScreenShareController, ScreenShareState } from "../model/controller";

/** Constante: o `getSnapshot` precisa devolver o mesmo objeto enquanto nada muda. */
const IDLE: ScreenShareState = { status: "idle" };

const noop = () => {};

/** Estado do compartilhamento, re-renderizando o componente a cada mudança. */
export function useScreenShareState(
	controller: ScreenShareController | null,
): ScreenShareState {
	const subscribe = useCallback(
		(onChange: () => void) =>
			controller ? controller.onStateChange(onChange) : noop,
		[controller],
	);

	const getSnapshot = useCallback(
		() => controller?.getState() ?? IDLE,
		[controller],
	);

	return useSyncExternalStore(subscribe, getSnapshot);
}

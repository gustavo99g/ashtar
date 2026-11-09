import { useState } from "react";
import type { AudioMode } from "@/lib/tauri/commands";
import type {
	ScreenShareController,
	ScreenShareState,
	ShareChange,
} from "../model/controller";

type ActiveState = Extract<ScreenShareState, { status: "active" }>;
export type AudioChoice = AudioMode["mode"];

/**
 * Os ajustes da transmissão no ar, para o popover do botão e o painel completo: mandar um ajuste
 * ao Rust (com o erro, se falhar, e a transmissão seguindo como estava) e as escolhas de áudio
 * que a fonte permite ("Do aplicativo" só para uma janela com processo).
 */
export function useShareControls(
	controller: ScreenShareController,
	state: ActiveState,
) {
	const [failure, setFailure] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function apply(change: ShareChange) {
		setBusy(true);
		setFailure(null);
		try {
			await controller.update(change);
		} catch (error) {
			setFailure(
				typeof error === "object" && error !== null && "message" in error
					? String(error.message)
					: String(error),
			);
		} finally {
			setBusy(false);
		}
	}

	const processId = state.source.processId;
	const audioChoices: AudioChoice[] =
		state.source.source.kind === "window" && processId != null
			? ["off", "application", "system"]
			: ["off", "system"];

	function audioMode(choice: AudioChoice): AudioMode {
		if (choice === "application" && processId != null) {
			return { mode: "application", processId };
		}
		return { mode: choice === "application" ? "off" : choice };
	}

	return { apply, busy, failure, audioChoices, audioMode };
}

import { useEffect } from "react";
import {
	openSharePanel,
	type ScreenShareController,
	useScreenShareState,
} from "@/features/screen-share";
import { onTrayShare, trayShareState } from "@/lib/tauri/commands";

/**
 * Liga a transmissão ao menu da bandeja (`tray.rs`): as opções aparecem enquanto há uma, e cada
 * clique vira o mesmo ajuste do painel. Não desenha nada.
 */
export function TrayShare({
	controller,
}: {
	controller: ScreenShareController;
}) {
	const state = useScreenShareState(controller);
	const sharing = state.status === "active";
	const paused = state.status === "active" && state.paused;

	useEffect(() => {
		void trayShareState(sharing, paused).catch((error: unknown) => {
			console.warn("Menu da bandeja não mudou:", error);
		});
	}, [sharing, paused]);

	// Sem chamada, sem opções na bandeja.
	useEffect(
		() => () => {
			void trayShareState(false, false).catch(() => {});
		},
		[],
	);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let cancelled = false;
		void onTrayShare((action) => {
			switch (action) {
				case "panel":
					openSharePanel();
					return;
				case "pause":
				case "resume":
					void controller
						.update({ kind: "paused", paused: action === "pause" })
						.catch((error: unknown) => {
							console.warn("Pausa pela bandeja falhou:", error);
						});
					return;
				case "stop":
					void controller.stop();
					return;
			}
		}).then((stop) => {
			if (cancelled) stop();
			else unlisten = stop;
		});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, [controller]);

	return null;
}

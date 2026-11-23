import { useEffect, useRef } from "react";
import {
	acceptRinging,
	declineOrHangUp,
	runCallAction,
} from "@/features/calls";
import { playPttSound, playRoomSound } from "@/features/notifications";
import {
	SHORTCUT_IDS,
	type ShortcutId,
	useShortcuts,
} from "@/features/settings";
import {
	setPushToTalkHeld,
	takeScreenshot,
	useInputChoice,
	useVoice,
} from "@/features/voice";
import { onShortcut, setShortcuts, shortcutInput } from "@/lib/tauri/commands";
import { keyInput, mouseInput } from "./windowInput";

/**
 * Os atalhos globais (ADR 0029, decisão 8), uma vez para o app inteiro: manda a lista para o Rust
 * ao abrir e a cada mudança, e liga cada "apertou" e "soltou" à ação. O Rust só avisa; quem decide
 * é aqui.
 *
 * - Desativar microfone e Desativar áudio: alternam, como os botões do painel.
 * - Pressionar para falar: abre o portão enquanto está apertado (só vale no modo Pressionar para
 *   falar), com o clique, se ligado em Notificações.
 * - Atender e Recusar ou desligar: só fazem algo com uma ligação tocando, chamando ou no ar.
 * - Tirar print da transmissão: a em foco, a assistida ou a própria (`takeScreenshot`).
 *
 * Com o Ashtar em foco, o gancho do Windows não recebe as teclas: a janela manda para o Rust cada
 * tecla e botão que vê, e o Rust trata como as do gancho (também na gravação de um atalho).
 */
export function GlobalShortcuts() {
	const shortcuts = useShortcuts();
	const voice = useVoice();
	const latest = useRef(voice);
	latest.current = voice;

	useEffect(() => {
		const bindings = SHORTCUT_IDS.flatMap((id) => {
			const shortcut = shortcuts[id];
			return shortcut ? [{ id, combo: shortcut.combo }] : [];
		});
		setShortcuts(bindings).catch((error: unknown) =>
			console.warn("Não foi possível mandar os atalhos:", error),
		);
	}, [shortcuts]);

	useEffect(() => {
		let alive = true;
		let unlisten: (() => void) | null = null;
		void onShortcut(({ id, pressed }) =>
			handleShortcut(id as ShortcutId, pressed, latest.current),
		).then((off) => {
			if (alive) unlisten = off;
			else off();
		});
		return () => {
			alive = false;
			unlisten?.();
			setPushToTalkHeld(false);
		};
	}, []);

	useEffect(() => {
		const send = (input: ReturnType<typeof keyInput>, down: boolean) => {
			if (!input) return;
			shortcutInput(input, down).catch(() => {});
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.repeat) return;
			send(keyInput(event), event.type === "keydown");
		};
		const onMouse = (event: MouseEvent) =>
			send(mouseInput(event.button), event.type === "mousedown");
		const options = { capture: true };
		window.addEventListener("keydown", onKey, options);
		window.addEventListener("keyup", onKey, options);
		window.addEventListener("mousedown", onMouse, options);
		window.addEventListener("mouseup", onMouse, options);
		return () => {
			window.removeEventListener("keydown", onKey, options);
			window.removeEventListener("keyup", onKey, options);
			window.removeEventListener("mousedown", onMouse, options);
			window.removeEventListener("mouseup", onMouse, options);
		};
	}, []);

	return null;
}

type Voice = ReturnType<typeof useVoice>;

export function handleShortcut(
	id: ShortcutId,
	pressed: boolean,
	voice: Voice,
): void {
	if (id === "ptt") {
		setPushToTalkHeld(pressed);
		const pushToTalk = useInputChoice.getState().mode === "ptt";
		if (pushToTalk && voice.room && !voice.isMuted) playPttSound(pressed);
		return;
	}
	if (!pressed) return;
	switch (id) {
		case "mute":
			void (voice.isMuted ? voice.unmute() : voice.mute());
			return;
		case "deafen":
			void (voice.isDeafened ? voice.undeafen() : voice.deafen());
			return;
		case "answer":
			runCallAction(acceptRinging);
			return;
		case "decline":
			runCallAction(declineOrHangUp);
			return;
		case "screenshot":
			void takeScreenshot(voice.room, voice.screenShare).then((taken) => {
				if (taken) playRoomSound("screenshot", { gap: false });
			});
			return;
	}
}

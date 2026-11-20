/**
 * O Ausente automático (ADR 0027): de 30 em 30 segundos, pergunta ao Rust quanto tempo faz que
 * ninguém mexe no teclado nem no mouse do Windows, e avisa a API pelo socket só quando muda. Quem
 * decide o que os outros veem é a API: só quem está Disponível vira Ausente.
 *
 * Numa sala de voz (ou numa ligação), ninguém fica ausente sozinho: quem joga de controle não toca
 * no teclado. Uma
 * conexão nova começa ativa na API, então, ocioso, o aviso vai de novo a cada `open`.
 */
import { useEffect, useRef } from "react";
import { useMaybeVoice } from "@/features/voice";
import { sendRealtime, useRealtimeOpen } from "@/lib/realtime";
import { idleSeconds } from "@/lib/tauri/commands";

/** De quanto em quanto tempo olhar. */
export const IDLE_POLL_MS = 30_000;
/** Parado por tanto tempo, fica Ausente. */
export const IDLE_AFTER_SECONDS = 10 * 60;

export function useIdleReporter(): void {
	const voice = useMaybeVoice();
	const inRoom =
		voice?.voiceKind != null &&
		voice.connectionState !== "disconnected" &&
		voice.connectionState !== "error";
	const open = useRealtimeOpen();
	const idle = useRef(false);
	const inRoomRef = useRef(inRoom);
	inRoomRef.current = inRoom;

	useEffect(() => {
		if (!open) return;
		// O socket (re)abriu: a API acha que esta conexão está ativa.
		if (idle.current) sendRealtime({ type: "idle", idle: true });
		let stopped = false;

		async function check() {
			let next = false;
			if (!inRoomRef.current) {
				try {
					next = (await idleSeconds()) >= IDLE_AFTER_SECONDS;
				} catch {
					// Sem o Rust (o navegador, os testes), ninguém fica ocioso.
					next = false;
				}
			}
			if (stopped || next === idle.current) return;
			if (sendRealtime({ type: "idle", idle: next })) idle.current = next;
		}

		void check();
		const timer = setInterval(() => void check(), IDLE_POLL_MS);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, [open]);

	// Entrar numa sala volta para ativo na hora, sem esperar a próxima olhada.
	useEffect(() => {
		if (inRoom && idle.current && sendRealtime({ type: "idle", idle: false })) {
			idle.current = false;
		}
	}, [inRoom]);
}

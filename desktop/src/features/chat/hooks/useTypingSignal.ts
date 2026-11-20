/**
 * Avisa os outros que a pessoa está escrevendo (ADR 0027): o `typing` pelo socket, no máximo de 3
 * em 3 segundos por canal. Quem está Invisível não manda nada (a API também descarta). Parar de
 * escrever não manda nada: o aviso some sozinho nos outros apps, ou quando a mensagem chega.
 */
import { useCallback, useRef } from "react";
import { useOptionalMe } from "@/features/identity";
import { sendRealtime } from "@/lib/realtime";

/** O intervalo entre dois avisos do mesmo canal. */
export const TYPING_EVERY_MS = 3_000;

export function useTypingSignal(channelId: string): () => void {
	const status = useOptionalMe()?.status;
	const last = useRef<{ channelId: string; at: number } | null>(null);
	return useCallback(() => {
		if (status === "invisible") return;
		const now = Date.now();
		const before = last.current;
		if (before?.channelId === channelId && now - before.at < TYPING_EVERY_MS)
			return;
		if (sendRealtime({ type: "typing", channel_id: channelId })) {
			last.current = { channelId, at: now };
		}
	}, [channelId, status]);
}

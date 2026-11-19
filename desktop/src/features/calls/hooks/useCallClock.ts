import { useEffect, useState } from "react";
import { useMaybeVoice } from "@/features/voice";

/**
 * Os segundos da ligação, contando de um em um; `null` fora dela (ou antes de a voz conectar).
 *
 * Conta desde que a voz deste computador entrou na sala da ligação (o `connectedAt` da voz, no
 * relógio daqui), e não desde o `answered_at` da API: o relógio do Windows e o do servidor quase
 * nunca batem, e a diferença aparecia como um minuto a mais (ou a menos) logo ao atender. É o
 * mesmo começo do tempo da tela da ligação.
 */
export function useCallClock(inCall: boolean): number | null {
	const voice = useMaybeVoice();
	const since =
		inCall && voice?.voiceKind === "call" ? (voice.connectedAt ?? null) : null;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (since === null) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [since]);
	return since === null ? null : Math.max(0, Math.floor((now - since) / 1000));
}

import { WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	retryRealtimeNow,
	useRealtimeRetryAt,
	useRealtimeStatus,
} from "@/lib/realtime";

/** Quedas mais curtas que isto não mostram nada. */
export const SHOW_AFTER_MS = 5000;

/**
 * A faixa "Sem conexão com o servidor" (v0.6, decisão 13; quadro "Faixa — sem conexão com o
 * servidor"), no alto da moldura, embaixo da barra de título. Aparece quando o tempo real fica mais
 * de [`SHOW_AFTER_MS`] sem conectar, conta a próxima tentativa e tem o Tentar agora. Quando ele
 * volta, some, e as features buscam de novo o que mudou (o `ready` com `resumed`). A voz não
 * depende dela: a sala segue pelo LiveKit.
 */
export function ConnectionBanner() {
	const status = useRealtimeStatus();
	const down = status === "connecting" || status === "reconnecting";
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (!down) {
			setVisible(false);
			return;
		}
		const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
		return () => clearTimeout(timer);
	}, [down]);

	if (!visible) return null;
	return <Banner />;
}

function Banner() {
	const retryAt = useRealtimeRetryAt();
	const now = useNow();
	const seconds =
		retryAt === null ? null : Math.max(1, Math.ceil((retryAt - now) / 1000));

	return (
		<div
			role="status"
			className="flex h-9 shrink-0 items-center gap-2.5 border-b border-warning/30 bg-warning-subtle px-4 text-[13px]"
		>
			<WifiOffIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-warning-text"
			/>
			<span className="font-semibold text-warning-text">
				Sem conexão com o servidor
			</span>
			<span className="grow text-muted-foreground">
				{seconds === null
					? "Tentando conectar…"
					: `Tentando de novo em ${seconds} s`}
			</span>
			<button
				type="button"
				disabled={seconds === null}
				onClick={retryRealtimeNow}
				className="h-6 rounded-md px-2.5 text-xs font-semibold text-warning-text hover:bg-warning/15 disabled:opacity-50"
			>
				Tentar agora
			</button>
		</div>
	);
}

function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

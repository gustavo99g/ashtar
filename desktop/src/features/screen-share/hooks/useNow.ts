import { useEffect, useState } from "react";

/** A hora de agora, atualizada a cada `everyMs`: os relógios do painel e do popover. */
export function useNow(everyMs = 1000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(timer);
	}, [everyMs]);
	return now;
}

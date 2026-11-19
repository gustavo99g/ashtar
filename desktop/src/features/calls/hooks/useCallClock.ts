import { useEffect, useState } from "react";

/**
 * Os segundos desde `since` (em segundos, como a API manda), contando de um em um. `null` sem
 * começo.
 */
export function useCallClock(since: number | null): number | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (since === null) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [since]);
	return since === null ? null : Math.max(0, Math.floor(now / 1000) - since);
}

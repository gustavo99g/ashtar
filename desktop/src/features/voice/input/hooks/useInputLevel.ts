import { useEffect, useState } from "react";
import { type InputLevel, subscribeInputLevel } from "../model/levelBus";

/**
 * O nível do microfone que a cadeia mede agora (cerca de 20 vezes por segundo), ou `null` quando
 * nenhuma cadeia está medindo há meio segundo (fora da sala e sem teste).
 */
export function useInputLevel(): InputLevel | null {
	const [level, setLevel] = useState<InputLevel | null>(null);
	useEffect(() => {
		let stale: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = subscribeInputLevel((next) => {
			setLevel(next);
			clearTimeout(stale);
			stale = setTimeout(() => setLevel(null), 500);
		});
		return () => {
			unsubscribe();
			clearTimeout(stale);
		};
	}, []);
	return level;
}

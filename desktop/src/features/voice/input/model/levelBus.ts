/**
 * O nível do microfone que a cadeia mede (o portão manda umas 20 vezes por segundo), para quem
 * mostra: o medidor de Voz e vídeo e a régua da sensibilidade. Fica fora do React: quem escuta
 * decide quando redesenhar.
 */

export interface InputLevel {
	/** O nível de pico dos últimos ~50 ms, em dBFS (-100 a 0), depois do volume de entrada. */
	level: number;
	/** O portão está deixando a voz passar. */
	open: boolean;
	/** O limiar de agora (o automático muda sozinho), em dBFS. */
	threshold: number;
}

type Listener = (level: InputLevel) => void;

const listeners = new Set<Listener>();

export function subscribeInputLevel(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function emitInputLevel(level: InputLevel): void {
	for (const listener of listeners) listener(level);
}

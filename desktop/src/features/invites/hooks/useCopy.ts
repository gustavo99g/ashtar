import { useEffect, useState } from "react";

/** Quanto tempo o botão fica em "Copiado". */
const COPIED_MS = 2000;

/**
 * Copiar para a área de transferência, com o "Copiado" de volta ao normal em 2 segundos.
 * `copied` diz qual botão copiou ("link", "message"...), para cada um mostrar o seu.
 */
export function useCopy() {
	const [copied, setCopied] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (copied === null && !failed) return;
		const timer = setTimeout(() => {
			setCopied(null);
			setFailed(false);
		}, COPIED_MS);
		return () => clearTimeout(timer);
	}, [copied, failed]);

	async function copy(which: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setFailed(false);
			setCopied(which);
		} catch {
			setCopied(null);
			setFailed(true);
		}
	}

	return { copied, failed, copy };
}

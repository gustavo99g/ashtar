/**
 * As URLs `blob:` dos arquivos que a tela mostra (ADR 0031, decisão 4): a foto de perfil, as
 * miniaturas e as imagens do chat. A API pede o token no cabeçalho, então a tela não aponta para a
 * API: o arquivo é baixado uma vez, vira uma URL `blob:` e fica guardado na memória. Passando de
 * `MAX_ENTRIES`, as mais antigas saem e a URL é liberada (o arquivo some só de quem não está mais
 * usando: a tela pede de novo quando precisar).
 */
import { useEffect, useState } from "react";
import { fetchFile } from "./api";

const MAX_ENTRIES = 400;

const cache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

/** A URL `blob:` do arquivo `id`, baixando na primeira vez. */
export function fileUrl(id: string): Promise<string> {
	const known = cache.get(id);
	if (known) {
		// Usado de novo: vai para o fim da fila.
		cache.delete(id);
		cache.set(id, known);
		return known;
	}
	const loading = fetchFile(id).then(
		(blob) => {
			const url = URL.createObjectURL(blob);
			resolved.set(id, url);
			return url;
		},
		(error: unknown) => {
			cache.delete(id);
			throw error;
		},
	);
	cache.set(id, loading);
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value as string;
		cache.delete(oldest);
		const url = resolved.get(oldest);
		if (url) URL.revokeObjectURL(url);
		resolved.delete(oldest);
	}
	return loading;
}

/** A URL já pronta, sem esperar (para o primeiro desenho não piscar a letra). */
export function readyFileUrl(id: string): string | undefined {
	return resolved.get(id);
}

/** Esquece tudo (ao sair da conta). */
export function clearFileCache(): void {
	for (const url of resolved.values()) URL.revokeObjectURL(url);
	cache.clear();
	resolved.clear();
}

/**
 * A URL do arquivo `id` para a tela: `undefined` enquanto baixa, sem `id` ou se falhou (aí quem
 * usa mostra o que mostraria sem o arquivo).
 */
export function useFileUrl(id: string | null | undefined): string | undefined {
	const [url, setUrl] = useState<{ id: string; url: string } | null>(() =>
		id && readyFileUrl(id) ? { id, url: readyFileUrl(id) as string } : null,
	);
	useEffect(() => {
		if (!id) return;
		let alive = true;
		fileUrl(id).then(
			(loaded) => alive && setUrl({ id, url: loaded }),
			() => {},
		);
		return () => {
			alive = false;
		};
	}, [id]);
	return id && url?.id === id ? url.url : undefined;
}

/**
 * As miniaturas ao vivo de algumas fontes (ADR 0019), como URLs de imagem prontas para um `<img>`.
 *
 * Abre as miniaturas no Rust ao montar, troca as fontes sem recomeçar quando a lista muda e para
 * ao desmontar. Cada imagem nova vira um `blob:` e a anterior da mesma fonte é liberada.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type SourceRef,
	thumbnailsStart,
	thumbnailsStop,
	thumbnailsUpdate,
} from "@/lib/tauri/commands";

export function sourceRefKey(source: SourceRef): string {
	return `${source.kind}:${source.id}`;
}

/** As fontes de uma chave de lista (`window:1,monitor:2`). */
function fromKeys(keys: string): SourceRef[] {
	if (keys === "") return [];
	return keys.split(",").map((key) => {
		const [kind, id] = key.split(":");
		return { kind: kind as SourceRef["kind"], id: Number(id) };
	});
}

/**
 * `sources`: as fontes que precisam de imagem agora (os cards visíveis), ou `null` para nenhuma.
 * Devolve a imagem mais nova de cada uma, pela `sourceRefKey`.
 */
export function useThumbnails(
	sources: readonly SourceRef[] | null,
): ReadonlyMap<string, string> {
	const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
	// A lista como texto: um array novo com as mesmas fontes não recomeça nada.
	const keys = sources ? sources.map(sourceRefKey).join(",") : null;
	const enabled = keys !== null;
	const latest = useRef(keys ?? "");
	latest.current = keys ?? "";
	const session = useRef<{ id: number | null; sent: string } | null>(null);

	// Abre e fecha. As fontes vão no começo; as trocas depois vêm do efeito de baixo.
	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		const current: { id: number | null; sent: string } = {
			id: null,
			sent: latest.current,
		};
		session.current = current;
		const created = new Map<string, string>();

		thumbnailsStart(fromKeys(current.sent), ({ source, jpeg }) => {
			if (cancelled) return;
			const key = sourceRefKey(source);
			const url = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
			const old = created.get(key);
			if (old) URL.revokeObjectURL(old);
			created.set(key, url);
			setUrls(new Map(created));
		}).then(
			(id) => {
				if (cancelled) {
					void thumbnailsStop(id);
					return;
				}
				current.id = id;
				// A lista mudou enquanto abria.
				if (latest.current !== current.sent) {
					current.sent = latest.current;
					void thumbnailsUpdate(id, fromKeys(current.sent));
				}
			},
			(error: unknown) => {
				// Sem miniatura, o seletor mostra o ícone: não é motivo para avisar ninguém.
				console.warn("Miniaturas não abriram:", error);
			},
		);

		return () => {
			cancelled = true;
			session.current = null;
			if (current.id !== null) void thumbnailsStop(current.id);
			for (const url of created.values()) URL.revokeObjectURL(url);
			setUrls(new Map());
		};
	}, [enabled]);

	useEffect(() => {
		const current = session.current;
		if (keys === null || !current || current.id === null) return;
		if (current.sent === keys) return;
		current.sent = keys;
		void thumbnailsUpdate(current.id, fromKeys(keys));
	}, [keys]);

	// Só as imagens das fontes pedidas agora.
	return useMemo(() => {
		if (keys === null) return new Map();
		const wanted = new Set(keys.split(","));
		return new Map([...urls].filter(([key]) => wanted.has(key)));
	}, [urls, keys]);
}

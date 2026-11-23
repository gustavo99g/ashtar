import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "@/components/ui/toast";
import { blackWatchStart, blackWatchStop } from "@/lib/tauri/commands";
import { sourceRefKey } from "../hooks/useThumbnails";
import { useScreenShareState } from "../hooks/useScreenShareState";
import type { ScreenShareController } from "../model/controller";
import {
	setShareBlack,
	useShareIsBlack,
} from "../stores/blackStore";
import { openSourcePicker } from "../stores/pickerStore";

/** As transmissões que já mostraram o aviso: uma vez por transmissão. */
const warned = new Set<number>();

/** Para os testes. */
export function resetBlackWarnings(): void {
	warned.clear();
}

function warn(sessionId: number): void {
	if (warned.has(sessionId)) return;
	warned.add(sessionId);
	toast.add({
		title: "Sua transmissão está saindo preta",
		description:
			"Filmes com proteção e alguns jogos em tela cheia não deixam capturar a imagem. Tente a janela em vez da tela, ou outra fonte.",
		data: { tone: "warning" },
		actionProps: {
			children: "Trocar fonte",
			onClick: () => openSourcePicker("change"),
		},
	});
}

/**
 * Confere, com a transmissão no ar e não pausada, se ela está saindo preta (decisão 26 do plano da
 * v0.8). Só quem transmite fica sabendo: o aviso uma vez por transmissão, e a faixa no preview
 * enquanto durar.
 */
export function BlackShareWatch({
	controller,
}: {
	controller: ScreenShareController;
}) {
	const state = useScreenShareState(controller);
	const watching = state.status === "active" && !state.paused;
	const source = state.status === "active" ? state.source.source : null;
	const sourceKey = source ? sourceRefKey(source) : null;
	const sessionId = state.status === "active" ? state.sessionId : null;

	useEffect(() => {
		if (!watching || !source || sessionId === null) return;
		let cancelled = false;
		let id: number | null = null;
		blackWatchStart(source, (black) => {
			if (cancelled) return;
			setShareBlack(black);
			if (black) warn(sessionId);
		})
			.then((started) => {
				if (cancelled) void blackWatchStop(started).catch(() => {});
				else id = started;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			setShareBlack(false);
			if (id !== null) void blackWatchStop(id).catch(() => {});
		};
		// A fonte entra pela chave: um objeto novo com a mesma fonte não recomeça.
	}, [watching, sourceKey, sessionId]);

	return null;
}

/** A faixa "Saindo preta" em cima do preview da própria transmissão. */
export function BlackShareBand() {
	const black = useShareIsBlack();
	if (!black) return null;
	return (
		<span className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-1.5 bg-warning px-2 py-1 text-xs font-semibold text-warning-foreground">
			<TriangleAlertIcon aria-hidden="true" className="size-3.5" />
			Saindo preta
		</span>
	);
}

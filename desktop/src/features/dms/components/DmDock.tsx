import { useLayoutEffect, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { usePeople } from "@/features/chat";
import type { Conversation } from "@/lib/api";
import {
	CountBadge,
	EMPTY_STATE,
	shownCount,
	useUnreadStore,
} from "@/features/unread";
import { paths } from "@/lib/paths";
import { personName, presenceById } from "../model/conversations";
import { useDms } from "../queries";
import { showDm, useOpenDms } from "../stores/openDmsStore";
import { DmAvatar } from "./DmAvatar";
import { DmWindow } from "./DmWindow";

/** Quantas conversas cabem embaixo, no máximo: a expandida e as abas. As outras ficam no "+N". */
export const DOCK_SLOTS = 3;

/** As medidas do dock, em px: a janela, a aba, o "+N", o espaço entre elas e as margens. */
const WINDOW_W = 440;
const TAB_W = 210;
const MORE_W = 52;
const GAP = 12;
const MARGIN = 16;

/**
 * Quantas abas cabem ao lado da janela expandida (v0.9): até `DOCK_SLOTS` contando a expandida, e
 * só as que cabem na largura da área do canal. Se sobrar conversa, o "+N" também precisa caber.
 * Sem a largura medida ainda (`null`), vale o máximo.
 */
export function dockTabs(
	width: number | null,
	expanded: boolean,
	others: number,
): number {
	const max = Math.min(others, DOCK_SLOTS - (expanded ? 1 : 0));
	if (width === null) return max;
	let room = width - 2 * MARGIN - (expanded ? WINDOW_W + GAP : 0);
	const fit = (space: number) =>
		Math.max(0, Math.floor((space + GAP) / (TAB_W + GAP)));
	if (fit(room) >= others && others <= max) return others;
	room -= MORE_W + GAP;
	return Math.min(max, fit(room));
}

/** A largura da camada do dock (a área do canal), acompanhando a janela. */
function useLayerWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const layer = ref.current?.parentElement;
		if (!layer) return;
		const measure = () => setWidth(layer.clientWidth || null);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(layer);
		return () => observer.disconnect();
	});
	return { ref, width };
}

/**
 * As conversas privadas abertas, embaixo da área do canal e encostadas na lateral (decisão 11 do
 * `PLAN.md`): a ativa expandida (`DmWindow`) e as outras como abas com o avatar e o nome. Cabem
 * três, se couberem na largura (`dockTabs`); além disso, um "+N" que traz a próxima da fila.
 *
 * Montado uma vez, no `AppShell`, numa camada do tamanho da área do canal, como a miniatura da
 * transmissão: a camada deixa o clique passar, e só as janelas e as abas o recebem. Como a camada
 * acaba onde a lateral começa, a janela fica ao lado da lateral aberta ou minimizada sem saber a
 * largura dela. Nas configurações, que cobrem tudo, não desenha.
 */
export function DmDock() {
	const open = useOpenDms((state) => state.open);
	const active = useOpenDms((state) => state.active);
	const dms = useDms();
	const people = usePeople();
	const inSettings = useMatch(`${paths.settings.root}/*`) !== null;
	const byChannel = useUnreadStore((store) => store.byChannel);
	const { ref, width } = useLayerWidth();
	if (inSettings || !dms.data) return <div ref={ref} hidden />;

	// Só as que a lista conhece: um id guardado de outra conta, ou de uma conversa vazia que não
	// voltou da API, não vira janela.
	const byId = new Map(dms.data.map((c) => [c.id, c]));
	const known = open
		.map((id) => byId.get(id))
		.filter((c): c is Conversation => c !== undefined);
	if (known.length === 0) return <div ref={ref} hidden />;

	const presence = presenceById(people.data);
	const expanded = known.find((c) => c.id === active);
	const others = known.filter((c) => c.id !== active);
	const tabs = others.slice(0, dockTabs(width, expanded !== undefined, others.length));
	const hidden = others.slice(tabs.length);

	return (
		<div
			ref={ref}
			className="absolute inset-y-0 right-4 flex flex-row-reverse items-end gap-3"
		>
			{expanded && (
				<DmWindow
					key={expanded.id}
					conversation={expanded}
					presence={presence.get(expanded.person.id) ?? null}
				/>
			)}
			{tabs.map((conversation) => (
				<button
					key={conversation.id}
					type="button"
					aria-label={`Abrir conversa com ${personName(conversation.person)}`}
					onClick={() => showDm(conversation.id)}
					className="pointer-events-auto flex h-[46px] w-[210px] items-center gap-2 rounded-t-[10px] border border-b-0 border-border-strong bg-card pr-3 pl-2 text-left shadow-[0_-6px_20px_rgba(0,0,0,0.4)] hover:bg-secondary"
				>
					<span className="relative shrink-0">
						<DmAvatar
							person={conversation.person}
							presence={presence.get(conversation.person.id) ?? null}
							size={28}
						/>
						<CountBadge
							count={shownCount(byChannel[conversation.id] ?? EMPTY_STATE)}
							className="absolute -top-1.5 -right-2 h-4 min-w-4 border-2 border-card px-1 py-0 text-[10px] leading-3"
						/>
					</span>
					<span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
						{personName(conversation.person)}
					</span>
				</button>
			))}
			{hidden.length > 0 && (
				<button
					type="button"
					aria-label={`Mais ${hidden.length} ${hidden.length === 1 ? "conversa aberta" : "conversas abertas"}`}
					title={hidden.map((c) => personName(c.person)).join(", ")}
					onClick={() => showDm(hidden[0].id)}
					className="pointer-events-auto flex h-[46px] items-center rounded-t-[10px] border border-b-0 border-border-strong bg-card px-3 text-[13px] font-semibold text-muted-foreground shadow-[0_-6px_20px_rgba(0,0,0,0.4)] hover:bg-secondary hover:text-foreground"
				>
					+{hidden.length}
				</button>
			)}
		</div>
	);
}

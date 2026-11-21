import {
	ClockIcon,
	FlagIcon,
	HandIcon,
	HashIcon,
	LeafIcon,
	LightbulbIcon,
	type LucideIcon,
	PlaneIcon,
	SearchIcon,
	SmileIcon,
	SparklesIcon,
	TrophyIcon,
	UtensilsIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { CustomEmoji, customId, useEmojiById, useGroupEmojis } from "@/features/emojis";
import { cn } from "@/lib/utils";
import {
	type EmojiEntry,
	type EmojiGroup,
	loadEmojiGroups,
	fold,
	searchEmoji,
} from "../model/emoji";
import { rememberEmoji, useRecentEmoji } from "../stores/recentEmojiStore";

const GROUP_ICONS: Record<string, LucideIcon> = {
	recent: ClockIcon,
	group: SparklesIcon,
	"smileys-emotion": SmileIcon,
	"people-body": HandIcon,
	"animals-nature": LeafIcon,
	"food-drink": UtensilsIcon,
	"travel-places": PlaneIcon,
	activities: TrophyIcon,
	objects: LightbulbIcon,
	symbols: HashIcon,
	flags: FlagIcon,
};

/** Um emoji que não está nos dados (um recente de outra versão): só o próprio texto. */
function bare(unicode: string): EmojiEntry {
	return { unicode, label: unicode, terms: "", shortcode: unicode };
}

/**
 * O seletor de emoji (o quadro "Chat — seletor de emoji"): a busca em cima, os botões das seções,
 * as seções com Recentes primeiro, depois os emojis do grupo (`c:<id>`, decisão 31), e embaixo o
 * emoji sob o mouse com o apelido. Escolher guarda nos Recentes e chama `onPick`.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
	const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [hovered, setHovered] = useState<EmojiEntry | null>(null);
	const recent = useRecentEmoji((state) => state.recent);
	const scroller = useRef<HTMLDivElement>(null);
	const groupEmojis = useGroupEmojis();
	const customById = useEmojiById();
	const custom = useMemo<EmojiGroup | null>(
		() =>
			groupEmojis.length === 0
				? null
				: {
						key: "group",
						label: "Do grupo",
						emojis: groupEmojis.map((emoji) => ({
							unicode: `c:${emoji.id}`,
							label: `:${emoji.name}:`,
							terms: `${fold(emoji.name)} ${fold(emoji.name.replace(/_/g, " "))}`,
							shortcode: emoji.name,
						})),
					},
		[groupEmojis],
	);

	useEffect(() => {
		let alive = true;
		loadEmojiGroups().then(
			(loaded) => alive && setGroups(loaded),
			() => alive && setFailed(true),
		);
		return () => {
			alive = false;
		};
	}, []);

	const byUnicode = useMemo(() => {
		const map = new Map<string, EmojiEntry>();
		for (const group of [...(custom ? [custom] : []), ...(groups ?? [])]) {
			for (const emoji of group.emojis) map.set(emoji.unicode, emoji);
		}
		return map;
	}, [groups, custom]);

	const sections = useMemo(() => {
		if (!groups) return [];
		const all: EmojiGroup[] = [];
		if (recent.length > 0) {
			all.push({
				key: "recent",
				label: "Recentes",
				emojis: recent
					// Um do grupo que foi excluído sai dos Recentes.
					.filter((e) => customId(e) === null || byUnicode.has(e))
					.map((e) => byUnicode.get(e) ?? bare(e)),
			});
		}
		if (custom) all.push(custom);
		return [...all, ...groups];
	}, [groups, recent, byUnicode, custom]);

	const results = useMemo(
		() =>
			groups && query.trim()
				? searchEmoji([...(custom ? [custom] : []), ...groups], query)
				: null,
		[groups, query, custom],
	);

	// Estável: as grades não desenham de novo a cada emoji sob o mouse (eram ~1900 botões, e o
	// rodapé mudando refazia todos).
	const onPickRef = useRef(onPick);
	onPickRef.current = onPick;
	const pick = useCallback((emoji: EmojiEntry) => {
		rememberEmoji(emoji.unicode);
		onPickRef.current(emoji.unicode);
	}, []);

	function jump(key: string) {
		setQuery("");
		requestAnimationFrame(() => {
			scroller.current
				?.querySelector<HTMLElement>(`[data-section="${key}"]`)
				?.scrollIntoView({ block: "start" });
		});
	}

	function grid(emojis: EmojiEntry[]) {
		return (
			<EmojiGrid
				emojis={emojis}
				byId={customById}
				onPick={pick}
				onHover={setHovered}
			/>
		);
	}

	return (
		<div
			role="dialog"
			aria-label="Escolher emoji"
			className="flex h-[430px] w-[380px] flex-col overflow-hidden"
		>
			<div className="flex flex-col gap-2.5 border-b border-border p-3">
				<label className="flex h-[34px] items-center gap-2 rounded-lg border border-border-strong bg-background px-2.5 text-muted-foreground focus-within:border-primary">
					<SearchIcon className="size-3.5 shrink-0" />
					<input
						type="search"
						autoFocus
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && results?.[0]) {
								event.preventDefault();
								pick(results[0]);
							}
						}}
						placeholder="Buscar emoji (ex.: fogo, risada)"
						aria-label="Buscar emoji"
						className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
					/>
				</label>
				<div className="flex gap-1">
					{sections.map((section) => {
						const Icon = GROUP_ICONS[section.key] ?? SmileIcon;
						return (
							<button
								key={section.key}
								type="button"
								aria-label={section.label}
								title={section.label}
								onClick={() => jump(section.key)}
								className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
							>
								<Icon className="size-4" />
							</button>
						);
					})}
				</div>
			</div>
			<div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
				{failed ? (
					<p className="py-10 text-center text-[13px] text-muted-foreground">
						Não deu para carregar os emojis.
					</p>
				) : !groups ? (
					<div className="flex justify-center py-10">
						<Spinner className="size-5 text-muted-foreground" />
					</div>
				) : results ? (
					results.length === 0 ? (
						<p className="py-10 text-center text-[13px] text-muted-foreground">
							Nenhum emoji com “{query.trim()}”.
						</p>
					) : (
						<div className="pt-2.5">{grid(results)}</div>
					)
				) : (
					sections.map((section) => (
						<section
							key={section.key}
							data-section={section.key}
							aria-label={section.label}
							// As seções fora da tela não são desenhadas até chegar nelas.
							className="[contain-intrinsic-size:auto_400px] [content-visibility:auto]"
						>
							<h3 className="px-0.5 pt-2.5 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
								{section.label}
							</h3>
							{grid(section.emojis)}
						</section>
					))
				)}
			</div>
			<div
				className={cn(
					"flex h-11 shrink-0 items-center gap-2.5 border-t border-border px-3.5 text-[13px] text-muted-foreground",
					!hovered && "invisible",
				)}
			>
				<span className="text-[22px]">
					{hovered && <EmojiGlyph entry={hovered} byId={customById} />}
				</span>
				<span className="truncate font-mono text-foreground">
					:{hovered?.shortcode}:
				</span>
			</div>
		</div>
	);
}

/** O emoji na grade e no rodapé: o Unicode, ou a imagem do emoji do grupo. */
function EmojiGlyph({
	entry,
	byId,
}: {
	entry: EmojiEntry;
	byId: ReadonlyMap<string, { name: string; file_id: string }>;
}) {
	const id = customId(entry.unicode);
	const emoji = id ? byId.get(id) : undefined;
	if (emoji) return <CustomEmoji emoji={emoji} className="size-7 align-middle" />;
	return <>{entry.unicode}</>;
}

const EmojiGrid = memo(function EmojiGrid({
	emojis,
	byId,
	onPick,
	onHover,
}: {
	emojis: EmojiEntry[];
	byId: ReadonlyMap<string, { name: string; file_id: string }>;
	onPick: (emoji: EmojiEntry) => void;
	onHover: (emoji: EmojiEntry) => void;
}) {
	return (
		<div className="grid grid-cols-8 gap-0.5">
			{emojis.map((emoji) => (
				<button
					key={emoji.unicode}
					type="button"
					aria-label={emoji.label}
					onClick={() => onPick(emoji)}
					onMouseEnter={() => onHover(emoji)}
					onFocus={() => onHover(emoji)}
					className="flex h-9 items-center justify-center rounded-md text-[22px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
				>
					<EmojiGlyph entry={emoji} byId={byId} />
				</button>
			))}
		</div>
	);
});

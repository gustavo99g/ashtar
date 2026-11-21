/**
 * O "Buscar no grupo" do cabeçalho (decisões 26 e 27 do plano da v0.7). O campo aceita os filtros
 * `de:`, `em:#` e `tem:`, com as sugestões embaixo enquanto se escreve um (como na menção). O Enter
 * abre os resultados numa caixa presa ao campo, por cima do chat: 25 por vez, da mais nova para a
 * mais velha, com o termo destacado. Por padrão só no canal aberto; "Todo o grupo" troca. Clicar
 * num resultado abre o canal dele e vai até a mensagem, que pisca.
 */
import { SearchIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
} from "@/components/ui/popover";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { textChannels, useChannelLayout } from "@/features/channels";
import { Avatar } from "@/features/identity";
import { ApiError, type Message, type SearchParams } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { attachmentsLabel } from "../model/attachments";
import { plainText } from "../model/markdown";
import { authorName, stampLabel } from "../model/messages";
import {
	completeFilter,
	filterAtEnd,
	fold,
	HAS_OPTIONS,
	hasSomething,
	highlight,
	parseSearch,
} from "../model/search";
import { usePeople, useSearch } from "../queries";
import { requestJump } from "../stores/jumpStore";

interface Suggestion {
	key: string;
	/** O filtro completo que entra no campo. */
	value: string;
	label: string;
	hint?: string;
}

/** As sugestões do filtro sendo escrito no fim do campo, até 6. */
function useSuggestions(text: string): {
	start: number;
	items: Suggestion[];
} | null {
	const people = usePeople().data;
	const layout = useChannelLayout().data;
	return useMemo(() => {
		const filter = filterAtEnd(text);
		if (!filter) return null;
		let items: Suggestion[];
		if (filter.kind === "de") {
			items = (people ?? [])
				.filter(
					(p) =>
						fold(p.nick).startsWith(filter.partial) ||
						fold(p.display_name ?? "").startsWith(filter.partial),
				)
				.map((p) => ({
					key: p.id,
					value: `de:${p.nick}`,
					label: p.display_name ?? p.nick,
					hint: `@${p.nick}`,
				}));
		} else if (filter.kind === "em") {
			items = (layout ? textChannels(layout) : [])
				.filter((c) => fold(c.name).startsWith(filter.partial))
				.map((c) => ({ key: c.id, value: `em:#${c.name}`, label: `#${c.name}` }));
		} else {
			items = HAS_OPTIONS.filter((o) => o.word.startsWith(filter.partial)).map(
				(o) => ({ key: o.word, value: `tem:${o.word}`, label: o.label }),
			);
		}
		return { start: filter.start, items: items.slice(0, 6) };
	}, [text, people, layout]);
}

export function SearchBox({ channelId }: { channelId: string }) {
	const [text, setText] = useState("");
	const [selected, setSelected] = useState(0);
	const [open, setOpen] = useState(false);
	const [wholeGroup, setWholeGroup] = useState(false);
	/** O que foi buscado no último Enter (o campo pode mudar depois). */
	const [submitted, setSubmitted] = useState<string | null>(null);
	const anchor = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const suggestions = useSuggestions(text);
	const shown = suggestions && suggestions.items.length > 0 ? suggestions : null;
	const channels = useChannelLayout().data;

	const request = useMemo(() => {
		if (submitted === null) return null;
		return parseSearch(
			submitted,
			channels ? textChannels(channels) : [],
			wholeGroup ? undefined : channelId,
		);
	}, [submitted, channels, wholeGroup, channelId]);
	const unknownChannel = request?.channelId === "";
	/** Com `em:#canal` escrito, o seletor "Este canal | Todo o grupo" não vale. */
	const typedChannel = submitted !== null && /(^|\s)em:\S/i.test(submitted);
	const params: SearchParams | null =
		request && hasSomething(request) && !unknownChannel ? request : null;

	function complete(item: Suggestion) {
		if (!shown) return;
		setText(completeFilter(text, shown.start, item.value));
		setSelected(0);
		input.current?.focus();
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (shown) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				setSelected((i) => (i + step + shown.items.length) % shown.items.length);
				return;
			}
			if (event.key === "Tab" || event.key === "Enter") {
				event.preventDefault();
				complete(shown.items[Math.min(selected, shown.items.length - 1)]);
				return;
			}
		}
		if (event.key === "Enter" && text.trim()) {
			event.preventDefault();
			setSubmitted(text.trim());
			setOpen(true);
		} else if (event.key === "Escape" && text) {
			event.preventDefault();
			setText("");
			setOpen(false);
		}
	}

	return (
		<div ref={anchor} className="relative ml-auto w-[min(240px,40%)] shrink-0">
			<SearchIcon
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<input
				ref={input}
				type="search"
				role="combobox"
				aria-label="Buscar no grupo"
				aria-expanded={shown !== null}
				aria-controls={shown ? "search-suggestions" : undefined}
				aria-autocomplete="list"
				placeholder="Buscar no grupo"
				title="Filtros: de:nick, em:#canal, tem:anexo, tem:imagem, tem:video, tem:link"
				value={text}
				onChange={(event) => {
					setText(event.target.value);
					setSelected(0);
				}}
				onKeyDown={onKeyDown}
				className="h-8 w-full rounded-lg border border-border bg-background pr-7 pl-8 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-focus focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
			/>
			{text && (
				<button
					type="button"
					aria-label="Limpar a busca"
					onClick={() => {
						setText("");
						setOpen(false);
						input.current?.focus();
					}}
					className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			)}
			{shown && (
				<ul
					id="search-suggestions"
					role="listbox"
					aria-label="Sugestões"
					className="absolute top-full right-0 left-0 z-40 mt-1 flex flex-col rounded-lg border border-border-strong bg-popover p-1 shadow-popover"
				>
					{shown.items.map((item, index) => (
						<li
							key={item.key}
							role="option"
							aria-selected={index === selected}
							onMouseDown={(event) => {
								event.preventDefault();
								complete(item);
							}}
							className={cn(
								"flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]",
								index === selected
									? "bg-selected text-selected-foreground"
									: "text-foreground hover:bg-secondary",
							)}
						>
							<span className="truncate">{item.label}</span>
							{item.hint && (
								<span className="truncate text-xs text-muted-foreground">
									{item.hint}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
			<Popover open={open && submitted !== null} onOpenChange={setOpen}>
				<PopoverContent
					anchor={anchor}
					align="end"
					initialFocus={false}
					finalFocus={false}
					className="max-h-[min(75vh,600px)] w-[min(460px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
				>
					<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
						<PopoverTitle className="min-w-0 flex-1 truncate text-sm font-bold">
							Resultados
						</PopoverTitle>
						{!typedChannel && (
							<Segmented
								aria-label="Onde buscar"
								value={wholeGroup ? "group" : "channel"}
								onValueChange={(value) => setWholeGroup(value === "group")}
							>
								<SegmentedItem value="channel">Este canal</SegmentedItem>
								<SegmentedItem value="group">Todo o grupo</SegmentedItem>
							</Segmented>
						)}
					</div>
					<Results
						params={params}
						problem={
							unknownChannel
								? "Esse canal não existe."
								: request && !hasSomething(request)
									? "Escreva o que buscar."
									: null
						}
						channelNames={
							new Map((channels ? textChannels(channels) : []).map((c) => [c.id, c.name]))
						}
						currentChannel={channelId}
						onPick={() => setOpen(false)}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function Results({
	params,
	problem,
	channelNames,
	currentChannel,
	onPick,
}: {
	params: SearchParams | null;
	problem: string | null;
	channelNames: Map<string, string>;
	currentChannel: string;
	onPick: () => void;
}) {
	const search = useSearch(params);
	const navigate = useNavigate();
	if (problem) return <Note>{problem}</Note>;
	if (search.isError) {
		return (
			<Note>
				{search.error instanceof ApiError
					? search.error.message
					: "Não deu para buscar. Tente de novo."}
			</Note>
		);
	}
	if (!search.messages) {
		return (
			<div className="flex justify-center py-6">
				<Spinner />
			</div>
		);
	}
	if (search.messages.length === 0) {
		return <Note>Nada encontrado. Tente outras palavras ou tire um filtro.</Note>;
	}
	return (
		<div className="flex min-h-0 flex-col overflow-y-auto">
			<ul aria-label="Resultados da busca" className="flex flex-col gap-2 p-3">
				{search.messages.map((message) => (
					<ResultItem
						key={message.id}
						message={message}
						words={params?.q ?? ""}
						channelName={channelNames.get(message.channel_id)}
						onOpen={() => {
							onPick();
							requestJump(message.channel_id, message.id);
							if (message.channel_id !== currentChannel) {
								navigate(paths.channel(message.channel_id));
							}
						}}
					/>
				))}
			</ul>
			{search.hasNextPage && (
				<button
					type="button"
					disabled={search.isFetchingNextPage}
					onClick={() => void search.fetchNextPage()}
					className="mx-3 mb-3 rounded-lg border border-border py-2 text-[13px] font-semibold text-link hover:bg-secondary disabled:opacity-60"
				>
					{search.isFetchingNextPage ? "Carregando…" : "Mais resultados"}
				</button>
			)}
		</div>
	);
}

function Note({ children }: { children: string }) {
	return (
		<p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
			{children}
		</p>
	);
}

function ResultItem({
	message,
	words,
	channelName,
	onOpen,
}: {
	message: Message;
	words: string;
	channelName: string | undefined;
	onOpen: () => void;
}) {
	const body = plainText(message.body);
	const names = (message.attachments ?? []).map((file) => file.name).join(" ");
	const text = body || names || attachmentsLabel(message.attachments ?? []);
	const parts = highlight(text, words);
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-focus"
			>
				<span className="flex min-w-0 items-center gap-2">
					<Avatar
						nick={message.author.nick}
						displayName={message.author.display_name}
						avatar={message.author.avatar}
						size={22}
					/>
					<span className="truncate text-sm font-semibold text-foreground">
						{authorName(message.author)}
					</span>
					{channelName && (
						<span className="shrink-0 text-xs text-muted-foreground">
							#{channelName}
						</span>
					)}
					<span className="ml-auto shrink-0 text-xs text-muted-foreground">
						{stampLabel(message.created_at)}
					</span>
				</span>
				<span className="line-clamp-3 text-sm whitespace-pre-wrap text-secondary-foreground">
					{parts.map((part, index) =>
						part.hit ? (
							<mark
								key={index}
								className="rounded-sm bg-gold/25 px-0.5 text-foreground"
							>
								{part.text}
							</mark>
						) : (
							<span key={index}>{part.text}</span>
						),
					)}
				</span>
			</button>
		</li>
	);
}

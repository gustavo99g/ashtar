import { MessageCircleIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/ui/states";
import { usePeople } from "@/features/chat";
import { useSession } from "@/features/identity";
import {
	CountBadge,
	EMPTY_STATE,
	shownCount,
	useUnreadStore,
} from "@/features/unread";
import { ApiError, type Conversation, type Person, type Shown } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	agoLabel,
	listedConversations,
	peopleToStart,
	personName,
	presenceById,
	preview,
} from "../model/conversations";
import { useDms, useOpenDm } from "../queries";
import { showDm, useOpenDms } from "../stores/openDmsStore";
import { DmAvatar } from "./DmAvatar";

/** De quanto em quanto tempo o "3 min" de cada linha é refeito. */
const TICK_MS = 30_000;

/**
 * A aba Conversas da lateral, como no quadro "Lateral — aba Conversas": o campo de busca e as
 * conversas, da que andou por último para a mais parada, cada uma com o avatar, o nome, o começo
 * da última mensagem e há quanto tempo foi. Clicar abre a janela da conversa embaixo (`DmDock`).
 *
 * O campo também começa conversas: com algo escrito, abaixo das conversas aparecem os membros que
 * ainda não têm uma. Sem nenhuma conversa, eles aparecem direto.
 */
export function DmList() {
	const dms = useDms();
	const people = usePeople();
	const session = useSession();
	const myId = session.status === "connected" ? session.user.id : null;
	const active = useOpenDms((state) => state.active);
	const openDm = useOpenDm();
	const [query, setQuery] = useState("");
	const [failure, setFailure] = useState<string | null>(null);
	const searchId = useId();
	const now = useNow();
	const byChannel = useUnreadStore((store) => store.byChannel);

	if (!dms.data) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
				{dms.isError ? (
					<ErrorState onRetry={() => void dms.refetch()} />
				) : (
					<LoadingState />
				)}
			</div>
		);
	}

	const presence = presenceById(people.data);
	const unreadOf = (id: string) => shownCount(byChannel[id] ?? EMPTY_STATE);
	const conversations = listedConversations(dms.data, query, unreadOf);
	const none = listedConversations(dms.data).length === 0;
	const starters =
		query.trim() || none
			? peopleToStart(people.data ?? [], dms.data, myId, query)
			: [];

	function start(person: Person) {
		setFailure(null);
		openDm(person.id)
			.then(() => setQuery(""))
			.catch((error: unknown) =>
				setFailure(
					error instanceof ApiError
						? error.message
						: "Não foi possível abrir a conversa.",
				),
			);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-2 pt-2.5 pb-1.5">
				<label htmlFor={searchId} className="sr-only">
					Buscar conversa
				</label>
				<input
					id={searchId}
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Buscar ou começar conversa"
					className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
				/>
			</div>
			{failure && (
				<p role="alert" className="px-4 pb-1 text-xs text-destructive-text">
					{failure}
				</p>
			)}
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
				{conversations.length > 0 && (
					<nav aria-label="Conversas" className="flex flex-col gap-0.5">
						{conversations.map((conversation) => (
							<ConversationRow
								key={conversation.id}
								conversation={conversation}
								presence={presence.get(conversation.person.id) ?? null}
								current={conversation.id === active}
								myId={myId}
								now={now}
								unread={unreadOf(conversation.id)}
							/>
						))}
					</nav>
				)}
				{starters.length > 0 && (
					<section
						aria-label="Começar uma conversa"
						className="flex flex-col gap-0.5"
					>
						<h3 className="px-2 pt-2 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
							Começar uma conversa
						</h3>
						{starters.map((person) => (
							<button
								key={person.id}
								type="button"
								onClick={() => start(person)}
								className="flex items-center gap-2.5 rounded-lg p-2 text-left hover:bg-secondary"
							>
								<DmAvatar
									person={person}
									presence={person.online ? person.status : null}
									size={34}
								/>
								<span className="min-w-0 truncate text-sm font-semibold text-foreground">
									{personName(person)}
								</span>
							</button>
						))}
					</section>
				)}
				{conversations.length === 0 && starters.length === 0 && (
					<div className="flex flex-1 flex-col items-center justify-center p-4">
						<EmptyState
							icon={<MessageCircleIcon />}
							title={query.trim() ? "Ninguém com esse nome" : "Nenhuma conversa ainda"}
							description={
								query.trim()
									? "Confira o nome ou o nick."
									: "As suas conversas privadas aparecem aqui."
							}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

function ConversationRow({
	conversation,
	presence,
	current,
	myId,
	now,
	unread,
}: {
	conversation: Conversation;
	presence: Shown | null;
	current: boolean;
	myId: string | null;
	now: number;
	unread: number;
}) {
	const last = conversation.last_message;
	return (
		<button
			type="button"
			aria-current={current ? "true" : undefined}
			onClick={() => showDm(conversation.id)}
			className={cn(
				"flex items-center gap-2.5 rounded-lg p-2 text-left hover:bg-secondary",
				current && "bg-secondary",
			)}
		>
			<DmAvatar person={conversation.person} presence={presence} size={34} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex justify-between gap-1.5">
					<span className="min-w-0 truncate text-sm font-semibold text-foreground">
						{personName(conversation.person)}
					</span>
					{last && (
						<span className="shrink-0 text-[11px] text-muted-foreground">
							{agoLabel(last.created_at, now)}
						</span>
					)}
				</span>
				<span className="flex items-center justify-between gap-1.5">
					<span
						className={cn(
							"min-w-0 truncate text-[12.5px]",
							unread > 0
								? "font-semibold text-foreground"
								: "text-muted-foreground",
						)}
					>
						{preview(conversation, myId)}
					</span>
					<CountBadge count={unread} className="shrink-0" />
				</span>
			</span>
		</button>
	);
}

/** A hora de agora, refeita de tempos em tempos para o "há quanto tempo" não ficar parado. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return now;
}

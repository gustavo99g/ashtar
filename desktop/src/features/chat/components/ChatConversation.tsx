import { ArrowRightIcon, ClockIcon, UploadIcon } from "lucide-react";
import {
	type DragEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "@/components/ui/toast";
import { ErrorState, LoadingState, OfflineState } from "@/components/ui/states";
import { useOptionalMe, useSession } from "@/features/identity";
import { useMarkRead, useUnreadMarker } from "@/features/unread";
import { ApiError, isApiError, type Message, type Person } from "@/lib/api";
import { useAppFocused } from "@/lib/visibility";
import type { Mentionable } from "../model/mentions";
import {
	useAroundMessages,
	useMessageActions,
	useMessages,
	usePeople,
	useSendMessage,
} from "../queries";
import { addDraftFiles, type DraftFile } from "../stores/attachmentStore";
import { usePending } from "../stores/outboxStore";
import { clearJump, useJumpStore } from "../stores/jumpStore";
import { cancelReply, startReply, useReplyStore } from "../stores/replyStore";
import { Composer } from "./Composer";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { MessageList } from "./MessageList";
import { PinsBar } from "./PinsBar";
import {
	canEdit,
	MessageActionsContext,
	type MessageActionsValue,
} from "./messageContext";

/**
 * A conversa de um canal de texto ou de uma conversa privada: o histórico e o campo de escrever.
 * Para a API as duas coisas são um canal com mensagens (ADR 0021), então aqui também: o
 * `channelId` é o id de qualquer uma, e o cache, a caixa de saída e o rascunho já são por id.
 *
 * Quem usa diz o que muda de um lugar para o outro: os dois rótulos, o que aparece no começo da
 * conversa, se o campo é o compacto e, se não dá para escrever, o que fica no lugar do campo.
 *
 * Aqui também se dá a conversa como lida (`useMarkRead`) e se decide onde fica a linha "Novas
 * mensagens" (`useUnreadMarker`). Quem usa monta uma por conversa (`key`), para a linha não passar
 * de uma para a outra.
 *
 * E as ações das mensagens (ADR 0032): editar, excluir (com a confirmação), responder, reagir e ir
 * até a original de uma resposta. Se ela não está no histórico carregado, abre o histórico em volta
 * dela (`useAroundMessages`), com a faixa "Ir para o presente".
 */
export function ChatConversation({
	channelId,
	listLabel,
	composerLabel,
	start,
	compact = false,
	readOnly,
	mentionable,
	aboveComposer,
	renderCall,
	kind = "channel",
}: {
	channelId: string;
	listLabel: string;
	composerLabel: string;
	start: ReactNode;
	compact?: boolean;
	/** Só para leitura: isto aparece no lugar do campo de escrever. */
	readOnly?: ReactNode;
	/** Quem dá para mencionar no campo. Sem isto, todo o grupo (o canal de texto). */
	mentionable?: readonly Mentionable[];
	/** Uma faixa em cima do campo de escrever (o "Voltar para a sala" do fim de uma ligação). */
	aboveComposer?: ReactNode;
	/** O registro de uma ligação no histórico (ver `MessageList`). */
	renderCall?: (message: Message) => ReactNode;
	/** Numa conversa privada o dono não exclui a mensagem da outra pessoa. */
	kind?: "channel" | "dm";
}) {
	const query = useMessages(channelId);
	const pending = usePending(channelId);
	const people = usePeople();
	const { send, retry, discard } = useSendMessage();
	const session = useSession();
	const ownerId =
		people.data?.find((person) => person.is_owner)?.id ??
		(session.status === "connected" && session.user.is_owner
			? session.user.id
			: null);
	const myId = session.status === "connected" ? session.user.id : null;
	const byId = useMemo(
		() => new Map((people.data ?? NO_PEOPLE).map((p) => [p.id, p])),
		[people.data],
	);
	const [seeingEnd, setSeeingEnd] = useState(true);
	const focused = useAppFocused();
	const lastMessageId = query.messages?.[query.messages.length - 1]?.id;
	/** A mensagem em volta da qual o histórico antigo está aberto (`null`: o de sempre). */
	const [anchor, setAnchor] = useState<string | null>(null);
	const around = useAroundMessages(channelId, anchor);
	useMarkRead(channelId, lastMessageId, seeingEnd && anchor === null);
	const unreadAfter = useUnreadMarker(channelId, focused && seeingEnd);

	const [focus, setFocus] = useState<{ id: string; key: number } | null>(null);
	const [highlightId, setHighlightId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Message | null>(null);
	const { edit, remove, react, pin } = useMessageActions();
	const canPin = useOptionalMe()?.can_manage_channels === true || kind === "dm";
	const shown = anchor === null ? query.messages : around.messages;

	const jumpTo = useCallback(
		(messageId: string) => {
			setFocus((current) => ({ id: messageId, key: (current?.key ?? 0) + 1 }));
			setHighlightId(messageId);
			window.setTimeout(
				() => setHighlightId((id) => (id === messageId ? null : id)),
				2000,
			);
			if (!shown?.some((m) => m.id === messageId)) setAnchor(messageId);
		},
		[shown],
	);

	// Um resultado da busca pedindo para ir até uma mensagem desta conversa.
	const jump = useJumpStore((state) =>
		state.request?.channelId === channelId ? state.request.messageId : null,
	);
	useEffect(() => {
		if (jump === null) return;
		clearJump();
		jumpTo(jump);
	}, [jump, jumpTo]);

	const removeNow = useCallback(
		(message: Message) => {
			remove(message).catch((error: unknown) =>
				toast.add({
					title: "Não deu para excluir a mensagem",
					description:
						error instanceof ApiError ? error.message : "Tente de novo.",
					data: { tone: "error" },
				}),
			);
		},
		[remove],
	);

	const actions = useMemo<MessageActionsValue>(
		() => ({
			myId,
			canModerate: kind === "channel" && ownerId !== null && ownerId === myId,
			people: byId,
			editingId,
			highlightId,
			startEdit: (message) => setEditingId(message.id),
			stopEdit: () => setEditingId(null),
			saveEdit: edit,
			reply: (message) => startReply(message),
			remove: (message, skipConfirm) =>
				skipConfirm ? removeNow(message) : setDeleting(message),
			react: (message, emoji, on) => {
				react(message, emoji, on).catch((error: unknown) =>
					toast.add({
						title: "Não deu para reagir",
						description:
							error instanceof ApiError ? error.message : "Tente de novo.",
						data: { tone: "error" },
					}),
				);
			},
			jumpTo,
			canPin,
			pin: (message, on) => {
				pin(message, on).catch((error: unknown) =>
					toast.add({
						title: on ? "Não deu para fixar" : "Não deu para desafixar",
						description:
							error instanceof ApiError ? error.message : "Tente de novo.",
						data: { tone: "error" },
					}),
				);
			},
		}),
		[
			myId,
			kind,
			ownerId,
			byId,
			editingId,
			highlightId,
			edit,
			removeNow,
			react,
			jumpTo,
			canPin,
			pin,
		],
	);

	/** A seta para cima no campo vazio: edita a última mensagem de quem escreve. */
	const editLast = useCallback(() => {
		const last = [...(query.messages ?? [])]
			.reverse()
			.find((message) => canEdit(message, myId));
		if (!last) return false;
		setAnchor(null);
		setEditingId(last.id);
		return true;
	}, [query.messages, myId]);

	function sendHere(body: string, files: DraftFile[]) {
		const reply = useReplyStore.getState().byChannel[channelId];
		send(
			channelId,
			body,
			reply && { id: reply.message.id, mention: reply.mention },
			files,
		);
		cancelReply(channelId);
		// Quem manda quer ver o que mandou: volta para o presente.
		setAnchor(null);
	}

	/**
	 * Arrastar arquivos para a conversa anexa, como o botão +. Enquanto eles estão em cima, o
	 * "Solte para enviar" cobre a conversa. `dragging` é quantos arquivos vêm (0: nenhum arrasto).
	 */
	const [dragging, setDragging] = useState(0);

	function acceptDrag(event: DragEvent<HTMLDivElement>) {
		if (readOnly || !event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		const count = Math.max(
			1,
			[...event.dataTransfer.items].filter((item) => item.kind === "file")
				.length,
		);
		setDragging(count);
	}

	function leaveDrag(event: DragEvent<HTMLDivElement>) {
		// Sair para um filho não é sair da conversa.
		const next = event.relatedTarget;
		if (next instanceof Node && event.currentTarget.contains(next)) return;
		setDragging(0);
	}

	function drop(event: DragEvent<HTMLDivElement>) {
		setDragging(0);
		if (readOnly || event.dataTransfer.files.length === 0) return;
		event.preventDefault();
		const problem = addDraftFiles(channelId, [...event.dataTransfer.files]);
		if (problem) toast.add({ title: problem, data: { tone: "error" } });
	}

	return (
		<MessageActionsContext.Provider value={actions}>
			<div
				className="relative flex min-h-0 flex-1 flex-col"
				onDragEnter={acceptDrag}
				onDragOver={acceptDrag}
				onDragLeave={leaveDrag}
				onDrop={drop}
			>
				<PinsBar channelId={channelId} actions={actions} compact={compact} />
				{anchor !== null && around.messages ? (
					<MessageList
						key={`around:${anchor}`}
						label={listLabel}
						start={start}
						messages={around.messages}
						pending={NO_PENDING}
						ownerId={ownerId}
						people={byId}
						myId={myId}
						hasOlder={around.hasPreviousPage}
						loadingOlder={around.isFetchingPreviousPage}
						onLoadOlder={() => void around.fetchPreviousPage()}
						hasNewer={around.hasNextPage}
						loadingNewer={around.isFetchingNextPage}
						onLoadNewer={() => void around.fetchNextPage()}
						onRetry={retry}
						onDiscard={discard}
						renderCall={renderCall}
						focusId={focus?.id ?? anchor}
						focusKey={focus?.key}
					/>
				) : anchor !== null && around.isError ? (
					<Centered>
						<ErrorState onRetry={() => setAnchor(null)} />
					</Centered>
				) : anchor !== null ? (
					<Centered>
						<LoadingState />
					</Centered>
				) : query.messages ? (
					<MessageList
						key="live"
						label={listLabel}
						start={start}
						messages={query.messages}
						pending={pending}
						ownerId={ownerId}
						people={byId}
						myId={myId}
						hasOlder={query.hasPreviousPage}
						loadingOlder={query.isFetchingPreviousPage}
						onLoadOlder={() => void query.fetchPreviousPage()}
						onRetry={retry}
						onDiscard={discard}
						unreadAfter={unreadAfter}
						onSeeingEndChange={setSeeingEnd}
						renderCall={renderCall}
						focusId={focus?.id}
						focusKey={focus?.key}
					/>
				) : query.isError ? (
					<Centered>
						{isApiError(query.error, "network") ? (
							<OfflineState onRetry={() => void query.refetch()} />
						) : (
							<ErrorState onRetry={() => void query.refetch()} />
						)}
					</Centered>
				) : (
					<Centered>
						<LoadingState />
					</Centered>
				)}
				{anchor !== null && (
					<div className={compact ? "px-2.5" : "px-4"}>
						<div
							role="status"
							className="mb-1.5 flex h-9 items-center gap-2.5 rounded-[10px] border border-border-strong bg-card pr-1.5 pl-3.5 text-[13px] text-secondary-foreground"
						>
							<ClockIcon className="size-[15px] shrink-0" />
							<span className="truncate">
								Você está vendo mensagens antigas
							</span>
							<button
								type="button"
								onClick={() => {
									setAnchor(null);
									setFocus(null);
								}}
								className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground hover:bg-primary-hover"
							>
								Ir para o presente
								<ArrowRightIcon className="size-3.5" />
							</button>
						</div>
					</div>
				)}
				{aboveComposer}
				{readOnly ?? (
					<Composer
						channelId={channelId}
						label={composerLabel}
						compact={compact}
						mentionable={mentionable ?? people.data ?? NO_PEOPLE}
						myId={myId}
						onSend={sendHere}
						onEditLast={editLast}
					/>
				)}
				{dragging > 0 && (
					<DropOverlay
						target={composerLabel.replace(/^Mensagem para /, "")}
						count={dragging}
						compact={compact}
					/>
				)}
			</div>
			<DeleteMessageDialog
				message={deleting}
				onConfirm={remove}
				onClose={() => setDeleting(null)}
			/>
		</MessageActionsContext.Provider>
	);
}

const NO_PEOPLE: Person[] = [];
const NO_PENDING: never[] = [];

function Centered({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
			{children}
		</div>
	);
}

/** O "Solte para enviar" em cima da conversa enquanto arquivos são arrastados para ela. */
function DropOverlay({
	target,
	count,
	compact,
}: {
	target: string;
	count: number;
	compact: boolean;
}) {
	return (
		<div
			aria-hidden="true"
			className={`pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-background/90 p-4 text-center ${compact ? "gap-2.5" : "gap-3.5"}`}
		>
			<span
				className={`flex items-center justify-center rounded-[18px] bg-primary/40 text-primary-foreground ${compact ? "size-14" : "size-[72px]"}`}
			>
				<UploadIcon
					strokeWidth={1.75}
					className={compact ? "size-7" : "size-[34px]"}
				/>
			</span>
			<span
				className={`font-bold text-foreground ${compact ? "text-lg" : "text-[22px]"}`}
			>
				Solte para enviar {compact ? "para" : "em"} {target}
			</span>
			<span className="text-sm text-secondary-foreground">
				{count === 1 ? "1 arquivo" : `${count} arquivos`} · você ainda pode
				escrever um texto antes de mandar
			</span>
			<span className="text-xs text-muted-foreground">
				Até 10 arquivos de até 100 MB cada
			</span>
		</div>
	);
}

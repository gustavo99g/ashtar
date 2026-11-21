import { ArrowDownIcon } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Spinner } from "@/components/ui/spinner";
import type { Message } from "@/lib/api";
import type { Mentionable } from "../model/mentions";
import { conversationRows } from "../model/messages";
import type { PendingMessage } from "../stores/outboxStore";
import { MessageItem, PendingItem } from "./MessageItem";

const NO_PEOPLE: ReadonlyMap<string, Mentionable> = new Map();

/** Até esta distância do fim, a conversa conta como "no fim" e acompanha as novas. */
const STICK_PX = 80;
/** Até esta distância do topo, busca a página anterior. */
const LOAD_OLDER_PX = 200;

interface MessageListProps {
	/** O nome da lista para quem usa leitor de tela: "Mensagens em #geral". */
	label: string;
	/** O que aparece antes da primeira mensagem, quando não há mais histórico para buscar. */
	start: ReactNode;
	messages: Message[];
	pending: PendingMessage[];
	ownerId: string | null;
	/** Quem está no grupo, por id: o nome das menções. */
	people?: ReadonlyMap<string, Mentionable>;
	/** Quem lê: a mensagem que o menciona ganha destaque. */
	myId?: string | null;
	hasOlder: boolean;
	loadingOlder: boolean;
	onLoadOlder: () => void;
	onRetry: (clientId: string) => void;
	onDiscard: (clientId: string) => void;
	/**
	 * A linha "Novas mensagens" fica depois da mensagem com este id (`null`: antes da primeira).
	 * `undefined`, sem linha.
	 */
	unreadAfter?: string | null;
	/** Avisa quando o fim do histórico entra ou sai da vista: é o que conta para marcar como lido. */
	onSeeingEndChange?: (seeingEnd: boolean) => void;
	/**
	 * Desenha o registro de uma ligação (`kind = "call"`, ADR 0023) no lugar da mensagem. Quem
	 * conhece as ligações é a conversa privada, que passa isto; sem isto, o registro aparece como
	 * uma mensagem comum ("Ligação").
	 */
	renderCall?: (message: Message) => ReactNode;
	/**
	 * Uma mensagem para mostrar no meio da tela (a citação clicada, ADR 0032). Muda o `focusKey` para
	 * ir de novo até a mesma.
	 */
	focusId?: string | null;
	focusKey?: number;
	/**
	 * O histórico aberto em volta de uma mensagem antiga: há mais novas para buscar ao chegar perto
	 * do fim, e a lista não acompanha as que chegam (elas vão para o histórico de sempre).
	 */
	hasNewer?: boolean;
	loadingNewer?: boolean;
	onLoadNewer?: () => void;
}

/**
 * A conversa. Abre no fim e acompanha as novas enquanto quem lê estiver no fim; quem subiu para
 * ler o histórico fica onde está, com o botão "Novas mensagens", a não ser que tenha acabado de
 * mandar uma: aí desce até ela. Chegando perto do topo, busca a página anterior sem pular a
 * leitura (a rolagem é compensada pela altura que entrou); se a página não enche a tela, busca a
 * anterior sem esperar a rolagem, que nunca viria.
 *
 * Com não lidas (`unreadAfter`), a linha "Novas mensagens" fica antes da primeira, e a conversa
 * abre rolada nela em vez de no fim.
 */
export function MessageList({
	label,
	start,
	messages,
	pending,
	ownerId,
	people = NO_PEOPLE,
	myId = null,
	hasOlder,
	loadingOlder,
	onLoadOlder,
	onRetry,
	onDiscard,
	unreadAfter,
	onSeeingEndChange,
	renderCall,
	focusId = null,
	focusKey = 0,
	hasNewer,
	loadingNewer = false,
	onLoadNewer,
}: MessageListProps) {
	/** No histórico em volta de uma mensagem, a lista fica parada onde a pessoa está lendo. */
	const follow = hasNewer === undefined;
	const ref = useRef<HTMLDivElement>(null);
	const lineRef = useRef<HTMLLIElement>(null);
	const atBottom = useRef(true);
	/** Se já se posicionou ao abrir: na linha das novas, ou no fim. */
	const opened = useRef(false);
	const seeingEndChange = useRef(onSeeingEndChange);
	seeingEndChange.current = onSeeingEndChange;
	const [showJump, setShowJump] = useState(false);
	/** A altura antes de entrar a página antiga, para manter a mesma mensagem à vista. */
	const heightBeforeOlder = useRef<number | null>(null);
	const firstId = messages[0]?.id;
	const lastKey = `${messages[messages.length - 1]?.id ?? ""}:${pending.length}`;
	/** Quantas estavam saindo daqui: se aumentou, foi a pessoa que mandou. */
	const pendingCount = useRef(pending.length);
	/** O `onLoadOlder` mais recente, sem fazer o efeito de encher a tela rodar a cada desenho. */
	const loadOlder = useRef(onLoadOlder);
	loadOlder.current = onLoadOlder;

	const setAtBottom = useCallback((value: boolean) => {
		if (atBottom.current === value) return;
		atBottom.current = value;
		seeingEndChange.current?.(value);
	}, []);

	const measureBottom = useCallback(() => {
		const list = ref.current;
		if (!list) return;
		const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
		setAtBottom(distance <= STICK_PX);
	}, [setAtBottom]);

	const scrollToBottom = useCallback(() => {
		const list = ref.current;
		if (list) list.scrollTop = list.scrollHeight;
		setAtBottom(true);
		setShowJump(false);
	}, [setAtBottom]);

	// Entrou página antiga no topo: desloca a rolagem pela altura nova.
	useLayoutEffect(() => {
		const list = ref.current;
		if (!list || heightBeforeOlder.current === null) return;
		list.scrollTop += list.scrollHeight - heightBeforeOlder.current;
		heightBeforeOlder.current = null;
	}, [firstId]);

	// Chegou mensagem no fim (ou saiu daqui): acompanha se estava no fim, ou se foi quem lê que
	// mandou (como no Discord, quem escreve quer ver o que mandou).
	useLayoutEffect(() => {
		const sentHere = pending.length > pendingCount.current;
		pendingCount.current = pending.length;
		if (lastKey === ":0") return;
		// Ao abrir com não lidas, começa na linha, com um respiro em cima.
		if (!opened.current) {
			opened.current = true;
			const list = ref.current;
			if (list && focusId && scrollToMessage(list, focusId)) {
				measureBottom();
				return;
			}
			const line = lineRef.current;
			if (list && line) {
				list.scrollTop = Math.max(0, line.offsetTop - 16);
				measureBottom();
				if (!atBottom.current) setShowJump(true);
				return;
			}
		}
		if (!follow) return;
		if (sentHere || atBottom.current) scrollToBottom();
		else setShowJump(true);
		// O `focusId` só conta ao abrir; depois, quem leva até a mensagem é o efeito abaixo.
	}, [lastKey, pending.length, scrollToBottom, measureBottom, follow]);

	// Pediram para ir até uma mensagem que já está na lista.
	useLayoutEffect(() => {
		const list = ref.current;
		if (!list || !focusId || !opened.current) return;
		scrollToMessage(list, focusId);
		measureBottom();
		// Só o pedido novo (`focusKey`) move a lista.
	}, [focusKey]);

	// A conversa não encheu a tela (mensagens curtas, janela grande): sem rolagem, o "chegou perto
	// do topo" nunca dispara, então busca a página anterior daqui. Sem altura (antes do layout), não
	// decide nada.
	useEffect(() => {
		const list = ref.current;
		if (!list || !hasOlder || loadingOlder || list.clientHeight === 0) return;
		if (list.scrollHeight <= list.clientHeight) {
			heightBeforeOlder.current = list.scrollHeight;
			loadOlder.current();
		}
	}, [messages.length, hasOlder, loadingOlder]);

	function onScroll() {
		const list = ref.current;
		if (!list) return;
		measureBottom();
		if (atBottom.current) setShowJump(false);
		if (list.scrollTop <= LOAD_OLDER_PX && hasOlder && !loadingOlder) {
			heightBeforeOlder.current = list.scrollHeight;
			onLoadOlder();
		}
		const toEnd = list.scrollHeight - list.scrollTop - list.clientHeight;
		if (toEnd <= LOAD_OLDER_PX && hasNewer && !loadingNewer) onLoadNewer?.();
	}

	const rows = conversationRows(messages);
	const firstUnread =
		unreadAfter === undefined
			? undefined
			: rows.find((row) => unreadAfter === null || row.message.id > unreadAfter)
					?.message.id;

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={ref}
				onScroll={onScroll}
				className="absolute inset-0 overflow-y-auto pb-4"
				data-testid="message-list"
			>
				{hasOlder ? (
					<div className="flex justify-center py-4">
						{loadingOlder && (
							<Spinner className="size-5 text-muted-foreground" />
						)}
					</div>
				) : (
					start
				)}
				<ol aria-label={label}>
					{rows.map((row) => (
						<RowWithDay key={row.message.id} day={row.day}>
							{row.message.id === firstUnread && (
								<li
									ref={lineRef}
									role="separator"
									aria-label="Novas mensagens"
									className="mx-4 mt-2 flex items-center gap-2 text-[11px] font-bold text-destructive-text uppercase"
								>
									<span className="h-px flex-1 bg-destructive-text/60" />
									Novas mensagens
								</li>
							)}
							{row.message.kind === "call" && renderCall ? (
								<li>{renderCall(row.message)}</li>
							) : (
								<MessageItem
									message={row.message}
									startsGroup={row.startsGroup}
									ownerId={ownerId}
									people={people}
									myId={myId}
								/>
							)}
						</RowWithDay>
					))}
					{hasNewer && (
						<li className="flex justify-center py-4">
							{loadingNewer && (
								<Spinner className="size-5 text-muted-foreground" />
							)}
						</li>
					)}
					{pending.map((message) => (
						<PendingItem
							key={message.client_id}
							message={message}
							onRetry={() => onRetry(message.client_id)}
							onDiscard={() => onDiscard(message.client_id)}
						/>
					))}
				</ol>
			</div>
			{showJump && (
				<button
					type="button"
					onClick={scrollToBottom}
					className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg"
				>
					<ArrowDownIcon className="size-3.5" />
					Novas mensagens
				</button>
			)}
		</div>
	);
}

/** Rola a lista até deixar a mensagem `id` no meio. Diz se achou. */
function scrollToMessage(list: HTMLElement, id: string): boolean {
	const row = list.querySelector<HTMLElement>(
		`[data-message-id="${CSS.escape(id)}"]`,
	);
	if (!row) return false;
	list.scrollTop = Math.max(
		0,
		row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2,
	);
	return true;
}

function RowWithDay({
	day,
	children,
}: {
	day: string | null;
	children: React.ReactNode;
}) {
	if (!day) return children;
	return (
		<>
			<li
				role="separator"
				aria-label={day}
				className="mx-4 mt-6 mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground"
			>
				<span className="h-px flex-1 bg-border" />
				{day}
				<span className="h-px flex-1 bg-border" />
			</li>
			{children}
		</>
	);
}

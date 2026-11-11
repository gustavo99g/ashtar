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
import { conversationRows } from "../model/messages";
import type { PendingMessage } from "../stores/outboxStore";
import { MessageItem, PendingItem } from "./MessageItem";

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
	hasOlder: boolean;
	loadingOlder: boolean;
	onLoadOlder: () => void;
	onRetry: (clientId: string) => void;
	onDiscard: (clientId: string) => void;
}

/**
 * A conversa. Abre no fim e acompanha as novas enquanto quem lê estiver no fim; quem subiu para
 * ler o histórico fica onde está, com o botão "Novas mensagens", a não ser que tenha acabado de
 * mandar uma: aí desce até ela. Chegando perto do topo, busca a página anterior sem pular a
 * leitura (a rolagem é compensada pela altura que entrou); se a página não enche a tela, busca a
 * anterior sem esperar a rolagem, que nunca viria.
 */
export function MessageList({
	label,
	start,
	messages,
	pending,
	ownerId,
	hasOlder,
	loadingOlder,
	onLoadOlder,
	onRetry,
	onDiscard,
}: MessageListProps) {
	const ref = useRef<HTMLDivElement>(null);
	const atBottom = useRef(true);
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

	const scrollToBottom = useCallback(() => {
		const list = ref.current;
		if (list) list.scrollTop = list.scrollHeight;
		atBottom.current = true;
		setShowJump(false);
	}, []);

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
		if (sentHere || atBottom.current) scrollToBottom();
		else setShowJump(true);
	}, [lastKey, pending.length, scrollToBottom]);

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
		const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
		atBottom.current = distance <= STICK_PX;
		if (atBottom.current) setShowJump(false);
		if (list.scrollTop <= LOAD_OLDER_PX && hasOlder && !loadingOlder) {
			heightBeforeOlder.current = list.scrollHeight;
			onLoadOlder();
		}
	}

	const rows = conversationRows(messages);

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
							<MessageItem
								message={row.message}
								startsGroup={row.startsGroup}
								ownerId={ownerId}
							/>
						</RowWithDay>
					))}
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

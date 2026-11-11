import { type ReactNode, useState } from "react";
import {
	ErrorState,
	LoadingState,
	OfflineState,
} from "@/components/ui/states";
import { useSession } from "@/features/identity";
import { useMarkRead, useUnreadMarker } from "@/features/unread";
import { isApiError } from "@/lib/api";
import { useAppFocused } from "@/lib/visibility";
import { useMessages, usePeople, useSendMessage } from "../queries";
import { usePending } from "../stores/outboxStore";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

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
 */
export function ChatConversation({
	channelId,
	listLabel,
	composerLabel,
	start,
	compact = false,
	readOnly,
}: {
	channelId: string;
	listLabel: string;
	composerLabel: string;
	start: ReactNode;
	compact?: boolean;
	/** Só para leitura: isto aparece no lugar do campo de escrever. */
	readOnly?: ReactNode;
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
	const [seeingEnd, setSeeingEnd] = useState(true);
	const focused = useAppFocused();
	const lastMessageId = query.messages?.[query.messages.length - 1]?.id;
	useMarkRead(channelId, lastMessageId, seeingEnd);
	const unreadAfter = useUnreadMarker(channelId, focused && seeingEnd);

	return (
		<>
			{query.messages ? (
				<MessageList
					label={listLabel}
					start={start}
					messages={query.messages}
					pending={pending}
					ownerId={ownerId}
					hasOlder={query.hasPreviousPage}
					loadingOlder={query.isFetchingPreviousPage}
					onLoadOlder={() => void query.fetchPreviousPage()}
					onRetry={retry}
					onDiscard={discard}
					unreadAfter={unreadAfter}
					onSeeingEndChange={setSeeingEnd}
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
			{readOnly ?? (
				<Composer
					channelId={channelId}
					label={composerLabel}
					compact={compact}
					onSend={(body) => send(channelId, body)}
				/>
			)}
		</>
	);
}

function Centered({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
			{children}
		</div>
	);
}

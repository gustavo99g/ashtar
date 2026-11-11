import type { ReactNode } from "react";
import {
	ErrorState,
	LoadingState,
	OfflineState,
} from "@/components/ui/states";
import { useSession } from "@/features/identity";
import { isApiError } from "@/lib/api";
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

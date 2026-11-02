import { HashIcon } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	OfflineState,
} from "@/components/ui/states";
import {
	DEFAULT_CHANNEL_ID,
	findChannel,
	setLastChannel,
	useChannelLayout,
} from "@/features/channels";
import { useSession } from "@/features/identity";
import { isApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { useMessages, usePeople, useSendMessage } from "../queries";
import { usePending } from "../stores/outboxStore";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { PeopleColumn } from "./PeopleColumn";

/**
 * A tela de um canal de texto: o cabeçalho com o nome e o tópico, a conversa, o campo de escrever
 * e a coluna de membros. É a tela do servidor desde a 0.2.3: abrir o app cai no último canal.
 */
export function ChatView({ channelId }: { channelId: string }) {
	const layout = useChannelLayout();
	const channel = layout.data ? findChannel(layout.data, channelId) : undefined;

	useEffect(() => {
		if (channel?.kind === "text") setLastChannel(channel.id);
	}, [channel]);

	if (!layout.data) {
		return layout.isError ? (
			<Centered>
				{isApiError(layout.error, "network") ? (
					<OfflineState onRetry={() => void layout.refetch()} />
				) : (
					<ErrorState onRetry={() => void layout.refetch()} />
				)}
			</Centered>
		) : (
			<Centered>
				<LoadingState />
			</Centered>
		);
	}
	if (!channel || channel.kind !== "text") return <MissingChannel />;

	return (
		<div className="flex h-full min-h-0">
			<section className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
					<HashIcon
						aria-hidden="true"
						className="size-[18px] shrink-0 text-muted-foreground"
					/>
					<h1 className="shrink-0 text-[15px] font-bold text-foreground">
						{channel.name}
					</h1>
					{channel.topic && (
						<>
							<span
								aria-hidden="true"
								className="h-6 w-px shrink-0 bg-border"
							/>
							<p
								title={channel.topic}
								className="min-w-0 truncate text-sm text-muted-foreground"
							>
								{channel.topic}
							</p>
						</>
					)}
				</header>
				<Conversation channelId={channel.id} channelName={channel.name} />
			</section>
			<PeopleColumn />
		</div>
	);
}

function Conversation({
	channelId,
	channelName,
}: {
	channelId: string;
	channelName: string;
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
					channelName={channelName}
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
			<Composer
				channelId={channelId}
				channelName={channelName}
				onSend={(body) => send(channelId, body)}
			/>
		</>
	);
}

/** O canal foi arquivado (ou nunca existiu): volta para o #geral. */
function MissingChannel() {
	const navigate = useNavigate();
	useEffect(() => {
		setLastChannel(DEFAULT_CHANNEL_ID);
	}, []);
	return (
		<Centered>
			<EmptyState
				icon={<HashIcon />}
				title="Esse canal não está mais aqui"
				description="Ele foi arquivado ou não existe."
				action={
					<Button
						onClick={() => void navigate(paths.channel(DEFAULT_CHANNEL_ID))}
					>
						Ir para o #geral
					</Button>
				}
			/>
		</Centered>
	);
}

function Centered({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
			{children}
		</div>
	);
}

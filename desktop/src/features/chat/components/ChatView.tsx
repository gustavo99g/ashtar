import { HashIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	OfflineState,
} from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import {
	allChannels,
	DEFAULT_CHANNEL_ID,
	findChannel,
	openChannelDialog,
	setLastChannel,
	useCanManageChannels,
	useChannelLayout,
} from "@/features/channels";
import { type ChannelView, isApiError, type Layout } from "@/lib/api";
import { usePeople } from "../queries";
import { setDraft } from "../stores/draftStore";
import { paths } from "@/lib/paths";
import { ChatConversation } from "./ChatConversation";
import { MediaButton } from "./MediaButton";
import { SearchBox } from "./SearchBox";

/**
 * A tela de um canal de texto: o cabeçalho com o nome e o tópico, a conversa e o campo de
 * escrever. É a tela do servidor desde a 0.2.3: abrir o app cai no último canal. Os membros ficam
 * na lateral (`features/side-panel`), que mora no `AppShell`.
 */
export function ChatView({ channelId }: { channelId: string }) {
	const layout = useChannelLayout();
	const channel = layout.data ? findChannel(layout.data, channelId) : undefined;

	useEffect(() => {
		if (channel?.kind === "text") setLastChannel(channel.id);
	}, [channel]);
	useLostChannel(channelId, channel, layout.data);
	const people = usePeople().data;
	// No canal restrito (ADR 0028), o @ só sugere quem está na lista e o dono.
	const mentionable = useMemo(() => {
		if (!channel?.restricted || !people) return undefined;
		const listed = new Set(channel.member_ids ?? []);
		return people.filter((person) => person.is_owner || listed.has(person.id));
	}, [channel, people]);

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
		<section className="flex h-full min-h-0 min-w-0 flex-col">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
				<HashIcon
					aria-hidden="true"
					className="size-5 shrink-0 text-muted-foreground"
				/>

				<h1 className="shrink-0 text-[15px] font-bold text-foreground">
					{channel.name}
				</h1>
				<ChannelTopic channel={channel} />
				<SearchBox channelId={channel.id} />
				<MediaButton channelId={channel.id} />
			</header>
			<ChatConversation
				channelId={channel.id}
				listLabel={`Mensagens em #${channel.name}`}
				composerLabel={`Mensagem para #${channel.name}`}
				start={<ChannelStart channelName={channel.name} />}
				mentionable={mentionable}
			/>
		</section>
	);
}

/**
 * O tópico ao lado do nome. Para quem gerencia os canais ele é um botão que abre o Editar canal já
 * no campo do tópico; sem tópico, mostra "Adicionar um tópico". Para os outros, é só texto.
 */
function ChannelTopic({ channel }: { channel: ChannelView }) {
	const canManage = useCanManageChannels();
	if (!channel.topic && !canManage) return null;
	const separator = (
		<span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
	);
	if (!canManage) {
		return (
			<>
				{separator}
				<p
					title={channel.topic ?? undefined}
					className="min-w-0 truncate text-[13px] text-muted-foreground"
				>
					{channel.topic}
				</p>
			</>
		);
	}
	return (
		<>
			{separator}
			<button
				type="button"
				title={channel.topic ?? undefined}
				aria-label={channel.topic ? "Editar o tópico" : "Adicionar um tópico"}
				onClick={() =>
					openChannelDialog({ kind: "editChannel", channel, focus: "topic" })
				}
				className="min-w-0 truncate rounded px-1 text-left text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
			>
				{channel.topic ?? "Adicionar um tópico"}
			</button>
		</>
	);
}

/** O começo do canal: aparece quando não há mais histórico para buscar. */
function ChannelStart({ channelName }: { channelName: string }) {
	return (
		<div className="flex flex-col gap-2 px-4 pt-8 pb-2">
			<span className="flex size-[68px] items-center justify-center rounded-full bg-secondary">
				<HashIcon aria-hidden="true" className="size-10 text-foreground" />
			</span>
			<h2 className="text-[28px] font-bold text-foreground">
				Bem-vindo a #{channelName}
			</h2>
			<p className="text-sm text-muted-foreground">
				Este é o começo do canal #{channelName}.
			</p>
		</div>
	);
}

/**
 * O canal aberto sumiu da lista enquanto a pessoa estava nele: foi arquivado, ou ela perdeu o acesso
 * a ele (ADR 0028). Ela volta para o primeiro canal com o aviso, e o rascunho dele vai embora.
 */
function useLostChannel(
	channelId: string,
	channel: ChannelView | undefined,
	layout: Layout | undefined,
) {
	const navigate = useNavigate();
	const seen = useRef<ChannelView | undefined>(undefined);
	useEffect(() => {
		const before = seen.current;
		seen.current = channel;
		// Só o mesmo canal sumindo: abrir um id que não existe é o "não está mais aqui".
		if (!layout || channel || before?.id !== channelId) return;
		setDraft(before.id, "");
		const first =
			allChannels(layout).find((c) => c.kind === "text")?.id ??
			DEFAULT_CHANNEL_ID;
		toast.add({
			title: `Você não tem mais acesso a #${before.name}`,
			description: "Ele foi arquivado ou ficou restrito.",
		});
		void navigate(paths.channel(first), { replace: true });
	}, [channelId, channel, layout, navigate]);
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

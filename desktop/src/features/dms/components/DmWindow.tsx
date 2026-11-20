import { BellIcon, BellOffIcon, MinusIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import {
	CallBanner,
	CallButton,
	CallEntry,
	clearMissed,
	ReturnToRoom,
} from "@/features/calls";
import { ChatConversation } from "@/features/chat";
import { useSession } from "@/features/identity";
import { setChannelMuted, useReadState } from "@/features/unread";
import type { Conversation, Shown } from "@/lib/api";
import { personName } from "../model/conversations";
import { closeDm, minimizeDm } from "../stores/openDmsStore";
import { DmAvatar } from "./DmAvatar";

/**
 * A janela de uma conversa privada, como no quadro "Lateral — conversa embaixo": 380 de largura
 * e até 540 de altura, presa embaixo, com os cantos de cima arredondados. No cabeçalho, quem é, se
 * está online (ou Ocupado), minimizar e fechar. O corpo é a mesma conversa de um canal de texto
 * (`ChatConversation`): o histórico em páginas, o rascunho, o "Tentar de novo", os links e o
 * agrupamento vêm juntos.
 *
 * O sino do cabeçalho silencia a conversa (Etapa 14): ela para de somar no número dourado, a não
 * ser pelas menções.
 *
 * A ligação (ADR 0023) entra aqui também: o Ligar no cabeçalho, a faixa de chamando, tocando ou em
 * ligação embaixo dele, o registro de cada ligação no histórico e, ao fim, o "Voltar para a sala"
 * em cima do campo. Abrir a conversa apaga a chamada perdida dela da lateral.
 *
 * O campo ganha o foco ao abrir (é o `Composer` que faz isso, a cada `channelId` novo), e o Esc,
 * com o foco em qualquer ponto da janela, fecha.
 */
export function DmWindow({
	conversation,
	presence,
}: {
	conversation: Conversation;
	/** O status de quem está do outro lado; `null` offline. */
	presence: Shown | null;
}) {
	const { person } = conversation;
	const name = personName(person);
	const { muted } = useReadState(conversation.id);
	const session = useSession();
	const myId = session.status === "connected" ? session.user.id : null;
	useEffect(() => clearMissed(conversation.id), [conversation.id]);
	return (
		<section
			aria-label={`Conversa com ${name}`}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					closeDm(conversation.id);
				}
			}}
			className="pointer-events-auto flex h-[min(540px,calc(100%-16px))] w-[380px] flex-col rounded-t-xl border border-b-0 border-border-strong bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.45)]"
		>
			<header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border pr-1.5 pl-3">
				<DmAvatar person={person} presence={presence} size={32} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-sm font-semibold text-foreground">
						{name}
					</span>
					<span className="truncate text-[11.5px] text-muted-foreground">
						{person.removed
							? "Saiu do grupo"
							: presence === "busy"
								? "Ocupado"
								: presence === "away"
									? "Ausente"
									: presence
									? "Online"
									: "Offline"}
					</span>
				</span>
				<CallButton
					variant="icon"
					person={person}
					presence={presence}
					resolveDm={() => Promise.resolve(conversation.id)}
				/>
				<HeaderButton
					label="Silenciar conversa"
					pressed={muted}
					onClick={() =>
						void setChannelMuted(conversation.id, !muted).catch(() => {})
					}
				>
					{muted ? (
						<BellOffIcon aria-hidden="true" className="size-4" />
					) : (
						<BellIcon aria-hidden="true" className="size-4" />
					)}
				</HeaderButton>
				<HeaderButton label="Minimizar conversa" onClick={minimizeDm}>
					<MinusIcon aria-hidden="true" className="size-4" />
				</HeaderButton>
				<HeaderButton
					label="Fechar conversa"
					onClick={() => closeDm(conversation.id)}
				>
					<XIcon aria-hidden="true" className="size-[15px]" />
				</HeaderButton>
			</header>
			<CallBanner channelId={conversation.id} />
			<ChatConversation
				channelId={conversation.id}
				listLabel={`Mensagens com ${name}`}
				composerLabel={`Mensagem para ${name}`}
				compact
				mentionable={person.removed ? [] : [person]}
				aboveComposer={<ReturnToRoom channelId={conversation.id} />}
				renderCall={(message) => (
					<CallEntry
						message={message}
						myId={myId}
						person={person.removed ? null : person}
						presence={presence}
					/>
				)}
				start={
					<p className="px-4 pt-6 pb-2 text-xs leading-relaxed text-muted-foreground">
						Este é o começo da sua conversa com {name}. As mensagens privadas
						ficam guardadas no servidor do grupo e não são criptografadas de
						ponta a ponta.
					</p>
				}
				readOnly={
					person.removed ? (
						<p className="shrink-0 border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
							{name} saiu do grupo. A conversa fica só para leitura.
						</p>
					) : undefined
				}
			/>
		</section>
	);
}

function HeaderButton({
	label,
	pressed,
	onClick,
	children,
}: {
	label: string;
	pressed?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			onClick={onClick}
			className="flex size-[30px] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
		>
			{children}
		</button>
	);
}

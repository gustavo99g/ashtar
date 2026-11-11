import { MinusIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ChatConversation } from "@/features/chat";
import type { Conversation } from "@/lib/api";
import { personName } from "../model/conversations";
import { closeDm, minimizeDm } from "../stores/openDmsStore";
import { DmAvatar } from "./DmAvatar";

/**
 * A janela de uma conversa privada, como no quadro "Lateral — conversa embaixo": 380 de largura
 * e até 540 de altura, presa embaixo, com os cantos de cima arredondados. No cabeçalho, quem é, se
 * está online, minimizar e fechar. O corpo é a mesma conversa de um canal de texto
 * (`ChatConversation`): o histórico em páginas, o rascunho, o "Tentar de novo", os links e o
 * agrupamento vêm juntos.
 *
 * O campo ganha o foco ao abrir (é o `Composer` que faz isso, a cada `channelId` novo), e o Esc,
 * com o foco em qualquer ponto da janela, fecha.
 */
export function DmWindow({
	conversation,
	online,
}: {
	conversation: Conversation;
	online: boolean;
}) {
	const { person } = conversation;
	const name = personName(person);
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
				<DmAvatar person={person} online={online} size={32} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-sm font-semibold text-foreground">
						{name}
					</span>
					<span className="truncate text-[11.5px] text-muted-foreground">
						{person.removed ? "Saiu do grupo" : online ? "Online" : "Offline"}
					</span>
				</span>
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
			<ChatConversation
				channelId={conversation.id}
				listLabel={`Mensagens com ${name}`}
				composerLabel={`Mensagem para ${name}`}
				compact
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
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="flex size-[30px] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
		>
			{children}
		</button>
	);
}

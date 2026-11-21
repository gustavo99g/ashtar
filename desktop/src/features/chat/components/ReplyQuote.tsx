import { Avatar } from "@/features/identity";
import type { ReplyRef } from "@/lib/api";
import { authorName } from "../model/messages";

/**
 * A citação de uma linha em cima da resposta (o quadro "Chat — respondendo"): o avatar pequeno, o
 * nome e o começo do texto, ligados ao avatar da resposta por um traço curvo. Clicar vai até a
 * original. Se ela foi excluída, fica "Mensagem original excluída", sem clique.
 */
export function ReplyQuote({
	reply,
	onJump,
}: {
	reply: ReplyRef;
	onJump?: (messageId: string) => void;
}) {
	const curve = (
		<span
			aria-hidden="true"
			className="absolute top-[9px] -left-9 h-3 w-[30px] rounded-tl-md border-t-2 border-l-2 border-border-strong"
		/>
	);
	if (!reply.author) {
		return (
			<div className="relative ml-5 flex min-w-0 items-center text-[13px]">
				{curve}
				<span className="text-foreground-subtle italic">
					Mensagem original excluída
				</span>
			</div>
		);
	}
	const name = authorName(reply.author);
	return (
		<button
			type="button"
			onClick={() => onJump?.(reply.id)}
			aria-label={`Ir para a mensagem de ${name}: ${reply.excerpt ?? ""}`}
			className="relative ml-5 flex max-w-full min-w-0 items-center gap-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground"
		>
			{curve}
			<Avatar
				nick={reply.author.nick}
				displayName={reply.author.display_name}
				size={16}
			/>
			<span className="shrink-0 font-semibold text-foreground">{name}</span>
			<span className="truncate">{reply.excerpt}</span>
		</button>
	);
}

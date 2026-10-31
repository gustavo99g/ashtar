import {
	CheckIcon,
	CopyIcon,
	MessageSquareTextIcon,
	PlusIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CreatedInviteView } from "@/lib/api";
import { dayAndTime, inviteAddress } from "../model/format";
import { ticketTitle } from "../model/presets";
import { useCopy } from "../hooks/useCopy";
import { InviteTicket } from "./InviteTicket";

/*
 * O convite recém-criado (quadro "Convites (convite criado)"): o bilhete com o link e o código,
 * que a API só mostra nesta resposta, e o "Criar outro convite" que volta ao formulário.
 */

interface CreatedInviteProps {
	invite: CreatedInviteView;
	onCreateAnother: () => void;
}

export function CreatedInvite({ invite, onCreateAnother }: CreatedInviteProps) {
	const { copied, failed, copy } = useCopy();
	// "hoje" e "amanhã" contam de quando o bilhete apareceu: o texto não muda com a tela aberta.
	const [shownAt] = useState(() => Date.now());
	const until = dayAndTime(invite.expires_at, shownAt);
	const message = `Te convidei para o Ashtar. Entra por aqui: ${invite.link}. Vale até ${until}.`;

	return (
		<div className="flex flex-col gap-3">
			<InviteTicket
				title={ticketTitle(invite.preset, invite.max_uses)}
				url={inviteAddress(invite.link, invite.code)}
				code={invite.code}
				validity={`Vale até ${until}`}
				count={invite.max_uses}
				countLabel={invite.max_uses === 1 ? "pessoa" : "pessoas"}
				notice={failed ? "Não deu para copiar." : undefined}
				actions={
					<>
						<Button onClick={() => void copy("link", invite.link)}>
							{copied === "link" ? (
								<CheckIcon strokeWidth={2.5} />
							) : (
								<CopyIcon />
							)}
							{copied === "link" ? "Copiado" : "Copiar link"}
						</Button>
						<Button
							variant="outline"
							onClick={() => void copy("message", message)}
						>
							{copied === "message" ? (
								<CheckIcon strokeWidth={2.5} />
							) : (
								<MessageSquareTextIcon />
							)}
							{copied === "message" ? "Copiado" : "Copiar com mensagem"}
						</Button>
					</>
				}
			/>
			<Button
				variant="link"
				className="gap-1.5 self-start text-[13px] font-medium"
				onClick={onCreateAnother}
			>
				<PlusIcon className="size-[15px]" />
				Criar outro convite
			</Button>
		</div>
	);
}

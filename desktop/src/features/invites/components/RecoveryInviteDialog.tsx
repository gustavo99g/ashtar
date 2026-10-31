import { CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import type { CreatedInviteView } from "@/lib/api";
import { dayAndTime, inviteAddress } from "../format";
import { useCopy } from "../useCopy";
import { InviteTicket } from "./InviteTicket";

/*
 * O convite de recuperação recém-criado ("Painel de controle: estados"), num diálogo por cima de
 * Membros: o bilhete com o link `/recovery/...` e o código, que a API só mostra agora. Abre
 * depois de desvincular, ou pelo menu do membro.
 */

interface RecoveryInviteDialogProps {
	/** O nome de quem vai usar: "juju". */
	name: string;
	/** O convite criado; `null` fecha o diálogo. */
	invite: CreatedInviteView | null;
	onClose: () => void;
}

export function RecoveryInviteDialog({
	name,
	invite,
	onClose,
}: RecoveryInviteDialogProps) {
	return (
		<Dialog open={invite !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="gap-[18px] rounded-2xl sm:max-w-[600px]">
				{invite && <RecoveryInviteContent name={name} invite={invite} />}
			</DialogContent>
		</Dialog>
	);
}

function RecoveryInviteContent({
	name,
	invite,
}: {
	name: string;
	invite: CreatedInviteView;
}) {
	const { copied, failed, copy } = useCopy();
	const [shownAt] = useState(() => Date.now());

	return (
		<>
			<div className="flex items-center gap-3.5">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-subtle text-gold">
					<KeyRoundIcon className="size-[19px]" />
				</span>
				<div className="flex min-w-0 flex-col gap-1">
					<DialogTitle className="truncate text-base">
						Convite de recuperação para {name}
					</DialogTitle>
					<DialogDescription className="text-[13px]">
						Mande só para essa pessoa.
					</DialogDescription>
				</div>
			</div>
			<InviteTicket
				title="Recuperação de conta"
				url={inviteAddress(invite.link, invite.code)}
				code={invite.code}
				validity={`Vale até ${dayAndTime(invite.expires_at, shownAt)}`}
				count={invite.max_uses}
				countLabel={invite.max_uses === 1 ? "uso" : "usos"}
				notice={failed ? "Não deu para copiar." : "Aparece só agora."}
				surface="card"
				actions={
					<Button onClick={() => void copy("link", invite.link)}>
						{copied === "link" ? <CheckIcon strokeWidth={2.5} /> : <CopyIcon />}
						{copied === "link" ? "Copiado" : "Copiar link"}
					</Button>
				}
			/>
			<div className="flex justify-end">
				<DialogClose
					render={<Button variant="ghost" className="font-medium" />}
				>
					Pronto
				</DialogClose>
			</div>
		</>
	);
}

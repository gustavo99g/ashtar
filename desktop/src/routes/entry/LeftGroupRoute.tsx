import { MonitorXIcon } from "lucide-react";
import {
	EntryFootnote,
	EntryHeader,
	EntryScreen,
	OrPasteDivider,
	PasteInvite,
	PersonCard,
} from "@/features/entry";
import { PersonName, useSession } from "@/features/identity";

/**
 * "Este computador saiu do grupo": o login respondeu `unknown_device` e o marcador diz que este
 * computador já teve uma conta (removida, ou o computador desvinculado: a API não diz qual). O
 * campo aceita um link de recuperação ou um convite novo.
 */
export function LeftGroupRoute() {
	const session = useSession();
	// `null` quando não deu para saber de quem era: a tela fica sem a caixa da conta.
	const account = session.status === "leftGroup" ? session.account : null;

	return (
		<EntryScreen labelledBy="saiu-titulo">
			<EntryHeader
				titleId="saiu-titulo"
				media={
					<span
						aria-hidden="true"
						className="flex size-16 items-center justify-center rounded-[16px] border border-destructive-border/30 bg-destructive-subtle text-destructive-text"
					>
						<MonitorXIcon className="size-7" />
					</span>
				}
				title="Este computador saiu do grupo"
				description="O dono removeu a sua conta ou desvinculou este computador. Para voltar, peça um link novo a ele e clique nele."
			/>
			{account && (
				<PersonCard
					nick={account.nick}
					faded
					detail="Neste computador, até agora"
				>
					Era a conta de{" "}
					<PersonName>{account.nick}</PersonName>
				</PersonCard>
			)}
			<OrPasteDivider />
			<PasteInvite
				label="Link ou código"
				placeholder="https://… ou 3RTW-8NB5-QZ6C"
				description="Serve um link de recuperação, que devolve a conta, ou um convite novo."
			/>
			<EntryFootnote className="text-center">
				Se você estava numa chamada, ela foi encerrada.
			</EntryFootnote>
		</EntryScreen>
	);
}

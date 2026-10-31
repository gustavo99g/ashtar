import { UnplugIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { CreatedInviteView, MemberView } from "@/lib/api";
import { memberName } from "../model/members";
import { useCreateRecoveryInvite, useUnlinkMember } from "../queries";

/*
 * "Desvincular o computador de juju?" ("Painel de controle: estados"). Com "Já criar o convite de
 * recuperação" marcado (o padrão), o app faz as duas chamadas em sequência e entrega o convite
 * criado. Se só a segunda falhar, o computador já saiu: o diálogo diz isso e oferece tentar de
 * novo, e o menu do membro continua com "Criar convite de recuperação".
 */

interface UnlinkDialogProps {
	/** Quem desvincular; `null` fecha o diálogo. */
	member: MemberView | null;
	onClose: () => void;
	/** Terminou: com o convite de recuperação, se ele foi criado. */
	onDone: (invite: CreatedInviteView | null) => void;
}

export function UnlinkDialog({ member, onClose, onDone }: UnlinkDialogProps) {
	return (
		<Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				{member && (
					<UnlinkContent key={member.id} member={member} onDone={onDone} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function UnlinkContent({
	member,
	onDone,
}: {
	member: MemberView;
	onDone: UnlinkDialogProps["onDone"];
}) {
	const [withRecovery, setWithRecovery] = useState(true);
	const unlink = useUnlinkMember();
	const recovery = useCreateRecoveryInvite();
	const checkboxId = useId();
	const busy = unlink.isPending || recovery.isPending;
	// O computador já saiu e só falta a recuperação.
	const unlinked = unlink.isSuccess;

	async function createRecovery() {
		try {
			onDone(await recovery.mutateAsync(member.id));
		} catch {
			// O diálogo mostra o erro e o "Tentar de novo".
		}
	}

	async function confirm() {
		try {
			await unlink.mutateAsync(member.id);
		} catch {
			return;
		}
		if (withRecovery) await createRecovery();
		else onDone(null);
	}

	return (
		<>
			<div className="flex gap-3.5">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-text">
					<UnplugIcon className="size-[19px]" />
				</span>
				<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
					<DialogTitle className="text-base">
						Desvincular o computador de {memberName(member)}?
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-[1.55]">
						O Ashtar sai da conta naquele computador na hora. Para voltar, a
						pessoa usa um convite de recuperação.
					</DialogDescription>
				</div>
			</div>
			{unlinked && recovery.isError ? (
				<p
					role="alert"
					className="ml-[54px] text-[13px] leading-[1.55] text-destructive-text"
				>
					O computador já saiu da conta, mas não deu para criar o convite de
					recuperação. {recovery.error.message}
				</p>
			) : (
				<label
					htmlFor={checkboxId}
					className="ml-[54px] flex items-center gap-2.5 text-[13px] text-secondary-foreground"
				>
					<Checkbox
						id={checkboxId}
						checked={withRecovery}
						disabled={busy || unlinked}
						onCheckedChange={setWithRecovery}
					/>
					Já criar o convite de recuperação
				</label>
			)}
			{unlink.isError && (
				<p role="alert" className="ml-[54px] text-[13px] text-destructive-text">
					Não deu para desvincular. {unlink.error.message}
				</p>
			)}
			<DialogFooter>
				{unlinked ? (
					<>
						<DialogClose
							render={<Button variant="ghost" className="font-medium" />}
						>
							Fechar
						</DialogClose>
						<Button disabled={busy} onClick={() => void createRecovery()}>
							{recovery.isPending && <Spinner />}
							Tentar de novo
						</Button>
					</>
				) : (
					<>
						<DialogClose
							render={<Button variant="ghost" className="font-medium" />}
						>
							Cancelar
						</DialogClose>
						<Button
							variant="warning"
							disabled={busy}
							onClick={() => void confirm()}
						>
							{busy && <Spinner />}
							Desvincular
						</Button>
					</>
				)}
			</DialogFooter>
		</>
	);
}

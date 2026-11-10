import { UserXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { MemberView } from "@/lib/api";
import { memberName } from "../model/members";
import { useRemoveMember } from "../queries";

/*
 * "Remover juju do grupo?" ("Painel de controle: estados"). A pessoa sai na hora; para voltar,
 * precisa de um convite novo. O dono nunca chega aqui: o menu dele não tem a opção.
 */

interface RemoveDialogProps {
	/** Quem remover; `null` fecha o diálogo. */
	member: MemberView | null;
	onClose: () => void;
	onDone: () => void;
}

export function RemoveDialog({ member, onClose, onDone }: RemoveDialogProps) {
	return (
		<Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				{member && (
					<RemoveContent key={member.id} member={member} onDone={onDone} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function RemoveContent({
	member,
	onDone,
}: {
	member: MemberView;
	onDone: () => void;
}) {
	const remove = useRemoveMember();
	return (
		<>
			<div className="flex gap-3.5">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive-subtle text-destructive-text">
					<UserXIcon className="size-[19px]" />
				</span>
				<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
					<DialogTitle className="text-base">
						Remover {memberName(member)} do grupo?
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-[1.55]">
						A pessoa sai na hora. Para voltar, precisa de um convite novo.
					</DialogDescription>
				</div>
			</div>
			{remove.isError && (
				<p role="alert" className="ml-[54px] text-[13px] text-destructive-text">
					Não deu para remover. {remove.error.message}
				</p>
			)}
			<DialogFooter>
				<DialogClose
					render={<Button variant="ghost" className="font-medium" />}
				>
					Cancelar
				</DialogClose>
				<Button
					variant="danger"
					disabled={remove.isPending}
					onClick={() => remove.mutate(member.id, { onSuccess: onDone })}
				>
					{remove.isPending && <Spinner />}
					Remover
				</Button>
			</DialogFooter>
		</>
	);
}

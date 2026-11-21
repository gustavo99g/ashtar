import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Avatar } from "@/features/identity";
import { ApiError, type Message } from "@/lib/api";
import { authorName, stampLabel } from "../model/messages";

/**
 * A confirmação de excluir (o quadro "Chat — excluir mensagem"), com a mensagem em miniatura e a
 * dica do Shift. Se a API recusar, o motivo aparece e o diálogo fica aberto.
 */
export function DeleteMessageDialog({
	message,
	onConfirm,
	onClose,
}: {
	message: Message | null;
	onConfirm: (message: Message) => Promise<void>;
	onClose: () => void;
}) {
	const [problem, setProblem] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function confirm() {
		if (!message || busy) return;
		setBusy(true);
		try {
			await onConfirm(message);
			setProblem(null);
			onClose();
		} catch (error) {
			setProblem(
				error instanceof ApiError
					? error.message
					: "Não foi possível excluir a mensagem.",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open={message !== null}
			onOpenChange={(open) => {
				if (!open) {
					setProblem(null);
					onClose();
				}
			}}
		>
			<DialogContent>
				<DialogTitle>Excluir mensagem</DialogTitle>
				<DialogDescription>
					Ela some para todo mundo, com os anexos e as reações. Não dá para
					desfazer.
				</DialogDescription>
				{message && (
					<div className="flex gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
						<Avatar
							nick={message.author.nick}
							displayName={message.author.display_name}
							size={32}
						/>
						<div className="flex min-w-0 flex-col gap-0.5">
							<span className="flex items-baseline gap-2">
								<span className="text-sm font-semibold text-foreground">
									{authorName(message.author)}
								</span>
								<span className="text-xs text-muted-foreground">
									{stampLabel(message.created_at)}
								</span>
							</span>
							<span className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-secondary-foreground">
								{message.body}
							</span>
						</div>
					</div>
				)}
				{problem ? (
					<p role="alert" className="text-xs text-destructive-text">
						{problem}
					</p>
				) : (
					<p className="text-xs text-foreground-subtle">
						Dica: segure Shift ao clicar em Excluir para pular esta confirmação.
					</p>
				)}
				<DialogFooter>
					<DialogClose render={<Button variant="ghost" />}>Cancelar</DialogClose>
					<Button
						variant="danger"
						disabled={busy}
						onClick={() => void confirm()}
					>
						Excluir
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

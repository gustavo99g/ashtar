import { SendIcon } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { useSendLogs } from "../queries";

const MAX_NOTE = 1000;

/**
 * O "Enviar logs" de Configurações › Aplicativo (v0.6, decisão 16): o campo "O que aconteceu?" e a
 * confirmação. O Rust junta os logs dos últimos 2 dias num `.zip`, e a API guarda para o dono.
 */
export function SendLogs({ className }: { className?: string }) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button variant="outline" className={className} onClick={() => setOpen(true)}>
				<SendIcon aria-hidden="true" className="size-[15px]" />
				Enviar logs
			</Button>
			<DialogContent>
				{open && <SendLogsForm onDone={() => setOpen(false)} />}
			</DialogContent>
		</Dialog>
	);
}

function SendLogsForm({ onDone }: { onDone: () => void }) {
	const [note, setNote] = useState("");
	const send = useSendLogs();
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<DialogTitle className="text-base">Enviar logs para o dono</DialogTitle>
				<DialogDescription className="text-[13px] leading-[1.55]">
					Vão os registros dos últimos 2 dias, com a versão do app e do Windows.
					Não têm mensagens, mas têm nicks. Só o dono vê.
				</DialogDescription>
			</div>
			<label className="flex flex-col gap-1.5">
				<span className="text-xs font-semibold text-secondary-foreground">
					O que aconteceu? <span className="font-normal">(opcional)</span>
				</span>
				<textarea
					value={note}
					maxLength={MAX_NOTE}
					rows={4}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Ex.: a voz caiu às 21h, quando a Ana começou a transmitir."
					className="resize-none rounded-lg border border-border bg-rail px-3 py-2 text-[13px] text-foreground placeholder:text-foreground-subtle focus-visible:border-ring focus-visible:outline-none"
				/>
			</label>
			{send.isError && (
				<p role="alert" className="text-[13px] text-destructive-text">
					{failure(send.error)}
				</p>
			)}
			<DialogFooter>
				<DialogClose render={<Button variant="ghost" className="font-medium" />}>
					Cancelar
				</DialogClose>
				<Button
					disabled={send.isPending}
					onClick={() =>
						send.mutate(note, {
							onSuccess: () => {
								onDone();
								toast.add({
									title: "Logs enviados",
									description: "O dono vai ver.",
									data: { tone: "success" },
								});
							},
						})
					}
				>
					{send.isPending && <Spinner />}
					Enviar
				</Button>
			</DialogFooter>
		</>
	);
}

function failure(error: Error): string {
	if (isApiError(error, "too_many_attempts")) {
		return "Você mandou logs há pouco. Espere uns minutos e tente de novo.";
	}
	return `Não deu para enviar. ${error.message}`;
}

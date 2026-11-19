/**
 * Entrar numa sala durante a ligação privada (Etapa 21 da v0.3): uma conexão de voz por vez, então
 * entrar encerra a ligação para os dois. Antes, este aviso.
 *
 * `useGuardedJoin` devolve o `join` que pergunta (só quando há ligação) e o diálogo, que quem usa
 * põe na tela.
 */
import { PhoneOffIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { useVoice } from "../../room/hooks/useVoice";

interface Pending {
	roomName: string;
	go: () => void;
}

export function useGuardedJoin(): {
	/** Faz `go` (entrar na sala), perguntando antes se a pessoa está numa ligação. */
	guard: (roomName: string, go: () => void) => void;
	dialog: ReactNode;
} {
	const { voiceKind, voiceTitle } = useVoice();
	const [pending, setPending] = useState<Pending | null>(null);

	function guard(roomName: string, go: () => void) {
		if (voiceKind === "call") setPending({ roomName, go });
		else go();
	}

	const dialog = (
		<Dialog
			open={pending !== null}
			onOpenChange={(open) => !open && setPending(null)}
		>
			<DialogContent>
				{pending && (
					<>
						<div className="flex gap-3.5">
							<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive-subtle text-destructive-text">
								<PhoneOffIcon className="size-[19px]" />
							</span>
							<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
								<DialogTitle className="text-base">
									Entrar na {pending.roomName} e encerrar a ligação?
								</DialogTitle>
								<DialogDescription className="text-[13px] leading-[1.55]">
									Dá para estar numa conexão de voz por vez. A ligação com{" "}
									{voiceTitle ?? "a outra pessoa"} acaba para vocês dois.
								</DialogDescription>
							</div>
						</div>
						<DialogFooter>
							<DialogClose
								render={<Button variant="ghost" className="font-medium" />}
							>
								Cancelar
							</DialogClose>
							<Button
								variant="danger"
								onClick={() => {
									const { go } = pending;
									setPending(null);
									go();
								}}
							>
								Encerrar e entrar
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);

	return { guard, dialog };
}

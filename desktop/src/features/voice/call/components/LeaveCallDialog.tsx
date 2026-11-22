/**
 * Entrar numa sala durante a ligação privada (Etapa 21 da v0.3): uma conexão de voz por vez, então
 * entrar encerra a ligação para os dois. Antes, este aviso.
 *
 * Trocar de sala (v0.5, ADR 0026) é um clique, sem pergunta, a não ser transmitindo ou com a câmera
 * ligada: as duas são da sala e acabam na troca. Aí pergunta, até a pessoa marcar "Não perguntar de
 * novo" (Configurações › Voz e vídeo liga de volta).
 *
 * `useGuardedJoin` devolve o `join` que pergunta (só quando há ligação) e o diálogo, que quem usa
 * põe na tela.
 */
import { ArrowRightLeftIcon, PhoneOffIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { useScreenShareState } from "@/features/screen-share";
import { useSettingsStore } from "@/features/settings";
import { useCameraState } from "../../camera/stores/cameraStore";
import { useVoice } from "../../room/hooks/useVoice";

interface Pending {
	/** `call`: está numa ligação. `switch`: transmite ou está com a câmera ligada noutra sala. */
	kind: "call" | "switch";
	roomName: string;
	go: () => void;
}

export function useGuardedJoin(): {
	/**
	 * Faz `go` (entrar na sala), perguntando antes se a pessoa está numa ligação, ou se está noutra
	 * sala transmitindo ou com a câmera ligada (ADR 0026: as duas acabam na troca).
	 */
	guard: (roomName: string, go: () => void) => void;
	dialog: ReactNode;
} {
	const { voiceKind, voiceTitle, screenShare } = useVoice();
	const sharing = useScreenShareState(screenShare).status === "active";
	const cameraOn = useCameraState((state) => state.on);
	const ask = useSettingsStore((state) => state.askBeforeSwitchRoom);
	const setAsk = useSettingsStore((state) => state.setAskBeforeSwitchRoom);
	const [pending, setPending] = useState<Pending | null>(null);
	const [dontAsk, setDontAsk] = useState(false);

	function guard(roomName: string, go: () => void) {
		if (voiceKind === "call") setPending({ kind: "call", roomName, go });
		else if (voiceKind === "room" && (sharing || cameraOn) && ask) {
			setDontAsk(false);
			setPending({ kind: "switch", roomName, go });
		} else go();
	}

	function confirm() {
		if (!pending) return;
		const { go, kind } = pending;
		if (kind === "switch" && dontAsk) setAsk(false);
		setPending(null);
		go();
	}

	const what = sharing
		? cameraOn
			? "A sua transmissão acaba e a câmera desliga"
			: "A sua transmissão acaba"
		: "A câmera desliga";

	const dialog = (
		<Dialog
			open={pending !== null}
			onOpenChange={(open) => !open && setPending(null)}
		>
			<DialogContent>
				{pending?.kind === "call" && (
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
							<Button variant="danger" onClick={confirm}>
								Encerrar e entrar
							</Button>
						</DialogFooter>
					</>
				)}
				{pending?.kind === "switch" && (
					<>
						<div className="flex gap-3.5">
							<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-text">
								<ArrowRightLeftIcon className="size-[19px]" />
							</span>
							<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
								<DialogTitle className="text-base">
									Trocar para a {pending.roomName}?
								</DialogTitle>
								<DialogDescription className="text-[13px] leading-[1.55]">
									{what} ao sair desta sala. Dá para ligar de novo na outra.
								</DialogDescription>
							</div>
						</div>
						<label className="flex items-center gap-2 text-[13px] text-secondary-foreground">
							<Checkbox
								checked={dontAsk}
								onCheckedChange={(checked) => setDontAsk(checked === true)}
							/>
							Não perguntar de novo
						</label>
						<DialogFooter>
							<DialogClose
								render={<Button variant="ghost" className="font-medium" />}
							>
								Cancelar
							</DialogClose>
							<Button onClick={confirm}>Trocar de sala</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);

	return { guard, dialog };
}

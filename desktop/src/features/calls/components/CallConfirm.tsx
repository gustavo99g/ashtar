/**
 * Os dois avisos antes de ligar (Etapa 20 da v0.3):
 *
 * - **"Ligar para fulano?"** (quadro "Conversas — aviso antes de ligar"), para quem está numa sala:
 *   a ligação é só entre os dois, então quem liga sai da sala quando a outra pessoa atender. Tem o
 *   "Não perguntar de novo", que Configurações › Voz e vídeo liga de volta.
 * - **"Ligar e encerrar a transmissão?"** (quadro "Conversas — ligar transmitindo"), para quem está
 *   transmitindo: diz quantos estão assistindo e aparece sempre, mesmo com o "Não perguntar de
 *   novo".
 */
import { PhoneIcon, ScreenShareOffIcon } from "lucide-react";
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

export type ConfirmKind = "room" | "share";

export function CallConfirm({
	kind,
	name,
	roomName,
	viewers,
	onConfirm,
	onClose,
}: {
	/** Qual dos dois; `null` fecha. */
	kind: ConfirmKind | null;
	/** Para quem é a ligação. */
	name: string;
	/** A sala de onde a pessoa vai sair. */
	roomName: string;
	/** Quantos estão assistindo a transmissão. */
	viewers: number;
	/** Confirmou; `dontAsk` é o "Não perguntar de novo" (só no aviso da sala). */
	onConfirm: (dontAsk: boolean) => void;
	onClose: () => void;
}) {
	return (
		<Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				{kind === "share" ? (
					<ShareContent
						name={name}
						roomName={roomName}
						viewers={viewers}
						onConfirm={() => onConfirm(false)}
					/>
				) : kind === "room" ? (
					<RoomContent name={name} roomName={roomName} onConfirm={onConfirm} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RoomContent({
	name,
	roomName,
	onConfirm,
}: {
	name: string;
	roomName: string;
	onConfirm: (dontAsk: boolean) => void;
}) {
	const [dontAsk, setDontAsk] = useState(false);
	const checkboxId = useId();
	return (
		<>
			<div className="flex gap-3.5">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-subtle text-gold-text">
					<PhoneIcon className="size-[19px]" />
				</span>
				<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
					<DialogTitle className="text-base">Ligar para {name}?</DialogTitle>
					<DialogDescription className="text-[13px] leading-[1.55]">
						A ligação é só entre vocês dois, então você sai da {roomName}.
						Quando ela acabar, dá para voltar com um clique.
					</DialogDescription>
				</div>
			</div>
			<label
				htmlFor={checkboxId}
				className="ml-[54px] flex items-center gap-2.5 text-[13px] text-secondary-foreground"
			>
				<Checkbox
					id={checkboxId}
					checked={dontAsk}
					onCheckedChange={setDontAsk}
				/>
				Não perguntar de novo
			</label>
			<DialogFooter>
				<DialogClose render={<Button variant="ghost" className="font-medium" />}>
					Cancelar
				</DialogClose>
				<Button onClick={() => onConfirm(dontAsk)}>
					<PhoneIcon aria-hidden="true" />
					Ligar
				</Button>
			</DialogFooter>
		</>
	);
}

function ShareContent({
	name,
	roomName,
	viewers,
	onConfirm,
}: {
	name: string;
	roomName: string;
	viewers: number;
	onConfirm: () => void;
}) {
	const watching =
		viewers === 0
			? "Ninguém está assistindo agora."
			: viewers === 1
				? "1 pessoa está assistindo."
				: `${viewers} pessoas estão assistindo.`;
	return (
		<>
			<div className="flex gap-3.5">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-text">
					<ScreenShareOffIcon className="size-[19px]" />
				</span>
				<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
					<DialogTitle className="text-base">
						Ligar e encerrar a transmissão?
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-[1.55]">
						{watching} Quando {name} atender, a sua transmissão acaba e você
						sai da {roomName}.
					</DialogDescription>
				</div>
			</div>
			<DialogFooter>
				<DialogClose render={<Button variant="ghost" className="font-medium" />}>
					Cancelar
				</DialogClose>
				<Button variant="warning" onClick={onConfirm}>
					Encerrar e ligar
				</Button>
			</DialogFooter>
		</>
	);
}

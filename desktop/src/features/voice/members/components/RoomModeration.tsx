/*
 * A seção Moderação no cartão de quem está numa sala de voz (quadro "Moderação — na voz"). Com
 * "Moderar voz" (v0.8, ADR 0034): Silenciar microfone, Deixar surdo e Bloquear sons (chaves; a
 * última é da v0.9), Desligar câmera (com ela ligada) e Encerrar transmissão (transmitindo, com a confirmação e o Shift para pular). Com
 * "Mover membros" (ADR 0026): Mover para e Desconectar da voz. O dono sempre tem as duas. Nunca no
 * próprio cartão, e ninguém modera o dono. A API manda as ordens para o app da pessoa; aqui só se
 * pede.
 */
import { QueryClientContext } from "@tanstack/react-query";
import {
	ArrowRightLeftIcon,
	HeadphoneOffIcon,
	LogOutIcon,
	MicOffIcon,
	MusicIcon,
	ScreenShareOffIcon,
	VideoOffIcon,
	Volume2Icon,
} from "lucide-react";
import { type MouseEvent, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { allChannels, useOptionalChannelLayout } from "@/features/channels";
import { useOptionalMe } from "@/features/identity";
import {
	disconnectMember,
	moderateCameraOff,
	moderateStopShare,
	moveMember,
	type Person,
	setServerDeafen,
	setServerMute,
	setSoundsBlocked,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/** Se quem usa o app pode mover e desconectar os outros. */
export function useCanMoveMembers(): boolean {
	return useOptionalMe()?.can_move_members === true;
}

/** Se quem usa o app pode silenciar, deixar surdo, desligar a câmera e encerrar a transmissão. */
export function useCanModerateVoice(): boolean {
	return useOptionalMe()?.can_moderate_voice === true;
}

/**
 * Se `userId` é o dono, pela lista de pessoas que a coluna já buscou (`GET /api/people`). Só lê o
 * cache; sem ele, a API recusa do mesmo jeito.
 */
function useIsOwner(userId: string): boolean {
	const client = useContext(QueryClientContext);
	const people = client?.getQueryData<Person[]>(["chat", "people"]);
	return people?.some((person) => person.id === userId && person.is_owner) === true;
}

/** O que a seção precisa saber de quem está no cartão. */
export interface ModeratedMember {
	camera?: boolean;
	sharing?: boolean;
	serverMuted?: boolean;
	serverDeafened?: boolean;
	soundsBlocked?: boolean;
}

function failed(what: string, error: unknown): void {
	toast.add({
		title: `Não deu para ${what}`,
		description:
			error instanceof Error ? error.message : "Tente de novo em instantes.",
		data: { tone: "error" },
	});
}

/**
 * Se `userId` pode estar na sala: a restrita (ADR 0028) só aceita quem está na lista dela. O dono e
 * quem gerencia os canais também entram, mas o app não sabe quem gerencia: na dúvida, a sala não é
 * oferecida, e a API continua sendo quem decide.
 */
export function roomAllows(
	room: { restricted: boolean; member_ids?: string[] },
	userId: string,
): boolean {
	return !room.restricted || (room.member_ids ?? []).includes(userId);
}

/** As salas de voz para onde dá para mover `userId`, que está em `roomId`. */
export function useMoveTargets(
	roomId: string,
	userId: string,
): { id: string; name: string }[] {
	const layout = useOptionalChannelLayout();
	if (!layout) return [];
	return allChannels(layout)
		.filter(
			(channel) =>
				channel.kind === "voice" &&
				channel.id !== roomId &&
				roomAllows(channel, userId),
		)
		.map((channel) => ({ id: channel.id, name: channel.name }));
}

/** Pede para mover; um erro vira o aviso do canto. */
export function requestMove(
	userId: string,
	name: string,
	room: { id: string; name: string },
): void {
	moveMember(userId, room.id).catch((error: unknown) => {
		toast.add({
			title: `Não deu para mover ${name}`,
			description:
				error instanceof Error ? error.message : "Tente de novo em instantes.",
			data: { tone: "error" },
		});
	});
}

export function RoomModeration({
	userId,
	name,
	roomId,
	roomName,
	member = {},
	onDone,
}: {
	userId: string;
	name: string;
	/** A sala em que a pessoa está agora. */
	roomId: string;
	/** O nome dela, para a confirmação de encerrar. */
	roomName?: string;
	/** A câmera, a tela e o que a moderação já impôs. */
	member?: ModeratedMember;
	/** Pediu: quem pôs a seção fecha o cartão. */
	onDone?: () => void;
}) {
	const canMove = useCanMoveMembers();
	const canModerate = useCanModerateVoice();
	const isOwner = useIsOwner(userId);
	const targets = useMoveTargets(roomId, userId);
	const [busy, setBusy] = useState(false);
	// O estado novo aparece na hora; o `voice.participants` confirma.
	const [muted, setMuted] = useState<boolean | null>(null);
	const [deafened, setDeafened] = useState<boolean | null>(null);
	const [soundsOff, setSoundsOff] = useState<boolean | null>(null);
	const [confirmStop, setConfirmStop] = useState(false);
	if ((!canMove && !canModerate) || isOwner) return null;
	const isMuted = muted ?? member.serverMuted === true;
	const isDeafened = deafened ?? member.serverDeafened === true;
	const isSoundsOff = soundsOff ?? member.soundsBlocked === true;

	function toggleMute(on: boolean) {
		setMuted(on);
		setServerMute(userId, on).catch((error: unknown) => {
			setMuted(null);
			failed(on ? `silenciar ${name}` : `liberar o microfone de ${name}`, error);
		});
	}

	function toggleDeafen(on: boolean) {
		setDeafened(on);
		setServerDeafen(userId, on).catch((error: unknown) => {
			setDeafened(null);
			failed(on ? `desligar o áudio de ${name}` : `devolver o áudio de ${name}`, error);
		});
	}

	function toggleSounds(on: boolean) {
		setSoundsOff(on);
		setSoundsBlocked(userId, on).catch((error: unknown) => {
			setSoundsOff(null);
			failed(on ? `bloquear os sons de ${name}` : `liberar os sons de ${name}`, error);
		});
	}

	function cameraOff() {
		moderateCameraOff(userId)
			.then(() => onDone?.())
			.catch((error: unknown) => failed(`desligar a câmera de ${name}`, error));
	}

	function stopShare() {
		setConfirmStop(false);
		moderateStopShare(userId)
			.then(() => onDone?.())
			.catch((error: unknown) =>
				failed(`encerrar a transmissão de ${name}`, error),
			);
	}

	function askStop(event: MouseEvent) {
		// Segurar Shift pula a pergunta, como no excluir.
		if (event.shiftKey) stopShare();
		else setConfirmStop(true);
	}

	function disconnect() {
		setBusy(true);
		disconnectMember(userId)
			.then(() => onDone?.())
			.catch((error: unknown) => {
				toast.add({
					title: `Não deu para desconectar ${name}`,
					description:
						error instanceof Error
							? error.message
							: "Tente de novo em instantes.",
					data: { tone: "error" },
				});
			})
			.finally(() => setBusy(false));
	}

	return (
		<section
			aria-label="Moderação"
			className="flex flex-col gap-1 border-t border-border pt-3"
		>
			<span className="px-2 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				Moderação
			</span>
			{canModerate && (
				<>
					<label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-foreground hover:bg-secondary">
						<MicOffIcon aria-hidden="true" className="size-4" />
						<span className="flex-1">Silenciar microfone</span>
						<Switch
							variant="blue"
							checked={isMuted}
							onCheckedChange={toggleMute}
						/>
					</label>
					<label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-foreground hover:bg-secondary">
						<HeadphoneOffIcon aria-hidden="true" className="size-4" />
						<span className="flex-1">Deixar surdo</span>
						<Switch
							variant="blue"
							checked={isDeafened}
							onCheckedChange={toggleDeafen}
						/>
					</label>
					<label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-foreground hover:bg-secondary">
						<MusicIcon aria-hidden="true" className="size-4" />
						<span className="flex-1">Bloquear sons</span>
						<Switch
							variant="blue"
							checked={isSoundsOff}
							onCheckedChange={toggleSounds}
						/>
					</label>
					{member.camera && (
						<button
							type="button"
							onClick={cameraOff}
							className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground hover:bg-secondary"
						>
							<VideoOffIcon aria-hidden="true" className="size-4" />
							Desligar câmera
						</button>
					)}
					{member.sharing && (
						<button
							type="button"
							onClick={askStop}
							className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-destructive-text hover:bg-destructive-subtle"
						>
							<ScreenShareOffIcon aria-hidden="true" className="size-4" />
							Encerrar transmissão
						</button>
					)}
				</>
			)}
			{canMove && (
				<>
			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={targets.length === 0}
					className={cn(
						"flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground hover:bg-secondary",
						"disabled:pointer-events-none disabled:opacity-50",
					)}
				>
					<ArrowRightLeftIcon aria-hidden="true" className="size-4" />
					Mover para
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-[200px]">
					{targets.map((room) => (
						<DropdownMenuItem
							key={room.id}
							onClick={() => {
								requestMove(userId, name, room);
								onDone?.();
							}}
						>
							<Volume2Icon className="size-[15px]" />
							<span className="truncate">{room.name}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<button
				type="button"
				disabled={busy}
				onClick={disconnect}
				className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-destructive-text hover:bg-destructive-subtle disabled:opacity-50"
			>
				<LogOutIcon aria-hidden="true" className="size-4" />
				Desconectar da voz
			</button>
				</>
			)}
			<Dialog open={confirmStop} onOpenChange={setConfirmStop}>
				<DialogContent>
					<DialogTitle>Encerrar a transmissão de {name}?</DialogTitle>
					<DialogDescription>
						A tela de {name} sai do ar para todos
						{roomName ? ` na ${roomName}` : " na sala"}. O microfone continua, e a
						câmera também, se não for desligada à parte. {name} pode transmitir de
						novo depois.
					</DialogDescription>
					<p className="text-xs text-muted-foreground">
						Segure Shift para pular esta confirmação.
					</p>
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" />}>
							Cancelar
						</DialogClose>
						<Button variant="danger" onClick={stopShare}>
							Encerrar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

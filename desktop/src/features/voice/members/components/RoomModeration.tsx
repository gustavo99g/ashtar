/*
 * "Mover para" e "Desconectar da voz" no cartão de quem está numa sala de voz (ADR 0026). Só para
 * quem tem "Mover membros" (`can_move_members`, o dono sempre tem), e nunca no próprio cartão: a
 * própria pessoa troca de sala clicando nela. A API manda a ordem para o app da pessoa, que troca
 * ou sai sozinho; aqui só se pede.
 */
import { ArrowRightLeftIcon, LogOutIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { allChannels, useOptionalChannelLayout } from "@/features/channels";
import { useOptionalMe } from "@/features/identity";
import { disconnectMember, moveMember } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Se quem usa o app pode mover e desconectar os outros. */
export function useCanMoveMembers(): boolean {
	return useOptionalMe()?.can_move_members === true;
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
		});
	});
}

export function RoomModeration({
	userId,
	name,
	roomId,
	onDone,
}: {
	userId: string;
	name: string;
	/** A sala em que a pessoa está agora. */
	roomId: string;
	/** Pediu: quem pôs a seção fecha o cartão. */
	onDone?: () => void;
}) {
	const canMove = useCanMoveMembers();
	const targets = useMoveTargets(roomId, userId);
	const [busy, setBusy] = useState(false);
	if (!canMove) return null;

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
				});
			})
			.finally(() => setBusy(false));
	}

	return (
		<section
			aria-label="Sala de voz"
			className="flex flex-col gap-1 border-t border-border pt-3"
		>
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
		</section>
	);
}

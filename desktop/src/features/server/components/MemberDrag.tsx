/*
 * Arrastar uma pessoa de uma sala de voz para outra na coluna (ADR 0026), para quem tem "Mover
 * membros". É uma exceção à regra "arrastar só no modo Organizar" (ADR 0020), porque nada da lista
 * muda de lugar: soltar numa sala pede o mesmo `POST /api/voice/move` do "Mover para" do cartão.
 *
 * O arrastar só começa depois de alguns pixels, para o clique no nome continuar abrindo o cartão.
 * Soltar na própria sala, ou fora de uma, não faz nada.
 */
import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type { ReactNode } from "react";
import { requestMove, roomAllows, useCanMoveMembers } from "@/features/voice";
import type { ChannelView } from "@/lib/api";

interface DraggedMember {
	userId: string;
	name: string;
	roomId: string;
}

interface RoomTarget {
	roomId: string;
	name: string;
	/** Só na sala restrita: quem pode estar nela. */
	restricted: boolean;
	member_ids?: string[];
}

/** Se dá para soltar `member` em `room`: outra sala, que aceita a pessoa. */
function accepts(room: RoomTarget, member: DraggedMember): boolean {
	return room.roomId !== member.roomId && roomAllows(room, member.userId);
}

export function MemberDragArea({ children }: { children: ReactNode }) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);

	function onDragEnd({ active, over }: DragEndEvent) {
		const member = active.data.current as DraggedMember | undefined;
		const room = over?.data.current as RoomTarget | undefined;
		if (!member || !room || !accepts(room, member)) return;
		requestMove(member.userId, member.name, {
			id: room.roomId,
			name: room.name,
		});
	}

	return (
		<DndContext sensors={sensors} onDragEnd={onDragEnd}>
			{children}
		</DndContext>
	);
}

/** A pessoa que se arrasta: só para quem pode mover, e nunca a própria. */
export function useMemberDrag(member: DraggedMember, self: boolean) {
	const canMove = useCanMoveMembers();
	const drag = useDraggable({
		id: `member:${member.roomId}:${member.userId}`,
		data: member,
		disabled: !canMove || self,
	});
	return { ...drag, enabled: canMove && !self };
}

/** A sala que recebe: em destaque com alguém de outra sala por cima, se ela aceita a pessoa. */
export function useRoomDrop(channel: ChannelView) {
	const room: RoomTarget = {
		roomId: channel.id,
		name: channel.name,
		restricted: channel.restricted,
		member_ids: channel.member_ids,
	};
	const drop = useDroppable({ id: `room:${channel.id}`, data: room });
	const member = drop.active?.data.current as DraggedMember | undefined;
	return {
		setNodeRef: drop.setNodeRef,
		highlighted:
			drop.isOver && member !== undefined && accepts(room, member),
	};
}

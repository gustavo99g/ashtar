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
import { requestMove, useCanMoveMembers } from "@/features/voice";

interface DraggedMember {
	userId: string;
	name: string;
	roomId: string;
}

interface RoomTarget {
	roomId: string;
	name: string;
}

export function MemberDragArea({ children }: { children: ReactNode }) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);

	function onDragEnd({ active, over }: DragEndEvent) {
		const member = active.data.current as DraggedMember | undefined;
		const room = over?.data.current as RoomTarget | undefined;
		if (!member || !room || room.roomId === member.roomId) return;
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

/** A sala que recebe: em destaque com alguém de outra sala por cima. */
export function useRoomDrop(roomId: string, name: string) {
	const drop = useDroppable({
		id: `room:${roomId}`,
		data: { roomId, name } satisfies RoomTarget,
	});
	const from = (drop.active?.data.current as DraggedMember | undefined)
		?.roomId;
	return {
		setNodeRef: drop.setNodeRef,
		highlighted: drop.isOver && from !== undefined && from !== roomId,
	};
}

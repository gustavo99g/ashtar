import { Avatar, StatusDot } from "@/features/identity";
import type { Shown } from "@/lib/api";

/**
 * O avatar de alguém numa conversa, com a bolinha do status de quem está online (verde ou a
 * vermelha de Ocupado). `presence` nulo é offline: sem bolinha.
 */
export function DmAvatar({
	person,
	presence,
	size,
}: {
	person: { nick: string; display_name: string | null };
	presence: Shown | null;
	size: number;
}) {
	return (
		<Avatar
			nick={person.nick}
			displayName={person.display_name}
			size={size}
			badge={presence && <StatusDot status={presence} className="size-[11px]" />}
		/>
	);
}

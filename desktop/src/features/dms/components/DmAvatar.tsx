import { Avatar } from "@/features/identity";

/** O avatar de alguém numa conversa, com a bolinha verde se está online. */
export function DmAvatar({
	person,
	online,
	size,
}: {
	person: { nick: string; display_name: string | null };
	online: boolean;
	size: number;
}) {
	return (
		<Avatar
			nick={person.nick}
			displayName={person.display_name}
			size={size}
			badge={
				online && (
					<span className="absolute -right-0.5 -bottom-0.5 box-border size-[11px] rounded-full border-2 border-card bg-status-online" />
				)
			}
		/>
	);
}

import { EyeIcon } from "lucide-react";
import { Avatar } from "@/features/identity";
import { cn } from "@/lib/utils";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import { useViewersOf } from "../../room/hooks/useShareViewers";

/** Quantos avatares aparecem antes do "+N". */
const SHOWN = 3;

/**
 * Quem está assistindo a transmissão de `owner` (ADR 0024): até três avatares e o "+N", com os
 * nomes no `title`. Some sem ninguém assistindo. Quem avisa é cada app (`model/viewers.ts`).
 */
export function ShareViewers({
	owner,
	className,
}: {
	owner: string;
	className?: string;
}) {
	const viewers = useViewersOf(owner);
	const members = useLiveMembers();
	const watching = members.filter((member) => viewers.has(member.id));
	if (watching.length === 0) return null;

	const names = watching.map((member) => member.name).join(", ");
	const rest = watching.length - SHOWN;
	return (
		<div
			role="img"
			aria-label={`Assistindo: ${names}`}
			title={`Assistindo: ${names}`}
			className={cn(
				"flex items-center gap-1.5 rounded-lg bg-rail/85 py-1 pr-2 pl-1.5",
				className,
			)}
		>
			<EyeIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
			<div className="flex -space-x-1.5">
				{watching.slice(0, SHOWN).map((member) => (
					<Avatar
						key={member.id}
						nick={member.nick}
						displayName={member.name}
						size={20}
						className="ring-2 ring-rail"
					/>
				))}
			</div>
			{rest > 0 && (
				<span className="font-mono text-[11px] text-secondary-foreground">
					+{rest}
				</span>
			)}
		</div>
	);
}

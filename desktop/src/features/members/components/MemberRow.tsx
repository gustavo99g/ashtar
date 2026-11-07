import { CrownIcon, LockIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Avatar } from "@/features/identity";
import { shortDate } from "@/lib/date";
import type { MemberView } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	type DeviceState,
	deviceText,
	joinedVia,
	memberName,
} from "../model/members";
import { type MemberActions, MemberMenu } from "./MemberMenu";

/*
 * Uma linha da lista de membros. Larga (`@3xl`, a largura da página), tem as colunas do quadro:
 * Membro, Computador, Entrou, Beta e o menu. Estreita, o Computador e o Entrou descem para debaixo
 * do nome, e o Beta e o menu ficam na primeira linha.
 */

/** As colunas, iguais no cabeçalho e nas linhas. */
export const MEMBER_GRID = cn(
	"grid grid-cols-[minmax(0,1fr)_64px_36px] items-center gap-x-4",
	"@3xl:grid-cols-[minmax(0,1fr)_240px_132px_64px_36px]",
);

const DEVICE_TONE: Record<DeviceState, { text: string; dot: string }> = {
	linked: { text: "text-secondary-foreground", dot: "bg-status-online" },
	none: { text: "text-warning-text", dot: "bg-status-connecting" },
	removed: { text: "text-destructive-text", dot: "bg-destructive-border" },
};

/** O selo dourado "Dono" ao lado do nome. */
export function OwnerBadge() {
	return (
		<span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-gold-subtle py-px pr-[7px] pl-[5px] text-[11px] font-bold text-gold">
			<CrownIcon className="size-[11px]" />
			Dono
		</span>
	);
}

interface MemberRowProps extends MemberActions {
	member: MemberView;
	canUnlink: boolean;
	onBetaChange: (enabled: boolean) => void;
}

export function MemberRow({
	member,
	canUnlink,
	onBetaChange,
	...actions
}: MemberRowProps) {
	const name = memberName(member);
	const removed = member.removed_at !== null;
	const device = deviceText(member);
	const tone = DEVICE_TONE[device.state];

	return (
		<li
			className={cn(
				MEMBER_GRID,
				"gap-y-1.5 border-t border-border py-2.5 pr-2.5 pl-3.5 hover:bg-card",
			)}
		>
			<button
				type="button"
				aria-label={`Detalhes de ${name}`}
				onClick={actions.onOpen}
				className={cn(
					"flex min-w-0 items-center gap-3 text-left",
					removed && "opacity-60",
				)}
			>
				<Avatar
					nick={member.nick}
					displayName={member.display_name}
					size={38}
				/>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate text-sm font-semibold text-foreground">
							{name}
						</span>
						{member.is_owner && <OwnerBadge />}
					</span>
					<span className="truncate text-xs text-muted-foreground">
						{member.nick}
					</span>
				</span>
			</button>

			{/* Estreita, esta caixa vira a segunda linha; larga, some (`contents`) e as duas colunas entram na grade. */}
			<div
				className={cn(
					"order-last col-span-full flex flex-wrap gap-x-6 gap-y-1 pl-[50px] @3xl:contents",
					removed && "opacity-60",
				)}
			>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span
						className={cn("flex items-center gap-[7px] text-[13px]", tone.text)}
					>
						<span
							aria-hidden="true"
							className={cn("size-[7px] shrink-0 rounded-full", tone.dot)}
						/>
						{device.label}
					</span>
					<span className="truncate pl-3.5 text-xs text-foreground-subtle">
						{device.detail}
					</span>
				</span>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="text-[13px] text-secondary-foreground">
						{shortDate(member.created_at)}
					</span>
					<span className="truncate text-xs text-foreground-subtle">
						{joinedVia(member)}
					</span>
				</span>
			</div>

			<span className="flex items-center">
				{member.is_owner ? (
					<span className="relative flex" title="O dono sempre recebe o beta">
						<Switch checked disabled aria-label="O dono sempre recebe o beta" />
						<LockIcon
							aria-hidden="true"
							strokeWidth={3}
							className="pointer-events-none absolute top-[6.5px] left-[25px] size-[9px] text-gold-subtle"
						/>
					</span>
				) : removed ? (
					<span className="text-[13px] text-foreground-faint">—</span>
				) : (
					<Switch
						checked={member.beta !== null}
						onCheckedChange={onBetaChange}
						aria-label={`Beta para ${name}`}
					/>
				)}
			</span>
			<span className="flex justify-end">
				{!removed && (
					<MemberMenu member={member} canUnlink={canUnlink} {...actions} />
				)}
			</span>
		</li>
	);
}

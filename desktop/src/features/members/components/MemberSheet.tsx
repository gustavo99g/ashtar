import {
	CalendarPlusIcon,
	CircleCheckIcon,
	CircleSlashIcon,
	FlaskConicalIcon,
	KeyRoundIcon,
	MonitorCheckIcon,
	MonitorXIcon,
	UnplugIcon,
	UserXIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Avatar, nickColor } from "@/features/identity";
import type { GrantView, MemberView } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	channelFact,
	deviceFact,
	joinedFact,
	type MemberFact,
	memberName,
} from "../members";
import { useMemberPermissions } from "../queries";
import type { MemberActions } from "./MemberMenu";
import { OwnerBadge } from "./MemberRow";

/*
 * A gaveta do membro (quadro "Membros (detalhes)"): quando entrou e com qual convite, o computador,
 * o canal e as permissões, na lista que a API devolve (`GET /api/members/{id}/permissions`), e
 * não numa lista fixa. Embaixo, as mesmas ações do menu.
 *
 * A gaveta fica por cima da lista (420px, ou a janela inteira se for menor), sem espremer as
 * colunas.
 */

interface MemberSheetProps extends Omit<MemberActions, "onOpen"> {
	/** Quem mostrar; `null` fecha a gaveta. */
	member: MemberView | null;
	canUnlink: boolean;
	onClose: () => void;
}

export function MemberSheet({
	member,
	canUnlink,
	onClose,
	...actions
}: MemberSheetProps) {
	// Fechando, a gaveta ainda desliza para fora com o último membro dentro.
	const last = useRef(member);
	if (member) last.current = member;
	const shown = member ?? last.current;

	return (
		<Sheet open={member !== null} onOpenChange={(open) => !open && onClose()}>
			<SheetContent showCloseButton={false}>
				{shown && (
					<MemberDetails member={shown} canUnlink={canUnlink} {...actions} />
				)}
			</SheetContent>
		</Sheet>
	);
}

function MemberDetails({
	member,
	canUnlink,
	onRecovery,
	onUnlink,
	onRemove,
}: Omit<MemberActions, "onOpen"> & { member: MemberView; canUnlink: boolean }) {
	const removed = member.removed_at !== null;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div
				aria-hidden="true"
				className="h-[104px] shrink-0"
				style={{
					backgroundImage: `linear-gradient(135deg, ${nickColor(member.nick)}, var(--selected))`,
				}}
			/>
			<SheetClose
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Fechar detalhes"
						className="absolute top-3.5 right-3.5 rounded-full bg-overlay text-foreground hover:bg-overlay hover:text-foreground"
					/>
				}
			>
				<XIcon strokeWidth={2.5} />
			</SheetClose>

			<div className="flex flex-1 flex-col gap-6 px-7 pb-7">
				<div className="flex flex-col gap-3">
					<Avatar
						nick={member.nick}
						displayName={member.display_name}
						size={76}
						className="-mt-[42px] border-5 border-card"
					/>
					<div className="flex min-w-0 flex-col gap-[3px]">
						<span className="flex min-w-0 items-center gap-2">
							<SheetTitle className="truncate text-xl">
								{memberName(member)}
							</SheetTitle>
							{member.is_owner && <OwnerBadge />}
							{removed && <Badge tone="danger">Removido</Badge>}
						</span>
						<span className="truncate text-[13px] text-muted-foreground">
							{member.nick}
						</span>
					</div>
				</div>

				<Section title="No grupo">
					<Fact icon={<CalendarPlusIcon />} fact={joinedFact(member)} />
					<Fact
						icon={
							member.device && !removed ? (
								<MonitorCheckIcon />
							) : (
								<MonitorXIcon />
							)
						}
						fact={deviceFact(member)}
					/>
					<Fact icon={<FlaskConicalIcon />} fact={channelFact(member)} />
				</Section>

				<Section title="Permissões">
					<Permissions memberId={member.id} />
				</Section>

				{!removed && (
					<div className="mt-auto flex flex-col gap-2.5 pt-2">
						<Button
							variant="outline"
							className="font-medium text-foreground"
							onClick={onRecovery}
						>
							<KeyRoundIcon className="size-[15px]" />
							Criar convite de recuperação
						</Button>
						<div className="flex gap-2.5">
							{canUnlink && (
								<Button
									variant="outline"
									className="flex-1 font-medium text-warning-text hover:border-destructive-border hover:bg-destructive-subtle hover:text-warning-text"
									onClick={onUnlink}
								>
									<UnplugIcon className="size-[15px]" />
									Desvincular
								</Button>
							)}
							{!member.is_owner && (
								<Button
									variant="outline"
									className="flex-1 font-medium text-destructive-text hover:border-destructive-border hover:bg-destructive-subtle hover:text-destructive-text"
									onClick={onRemove}
								>
									<UserXIcon className="size-[15px]" />
									Remover
								</Button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3.5">
			<h2 className="text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase">
				{title}
			</h2>
			{children}
		</section>
	);
}

function Fact({ icon, fact }: { icon: ReactNode; fact: MemberFact }) {
	return (
		<div className="flex gap-3">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground [&>svg]:size-[15px]">
				{icon}
			</span>
			<span className="flex min-w-0 flex-col gap-0.5 pt-px">
				<span className="text-[13px] text-foreground">{fact.title}</span>
				<span className="text-xs text-foreground-subtle">{fact.detail}</span>
			</span>
		</div>
	);
}

/** O selo à direita de cada permissão. */
function originLabel(grant: GrantView): string {
	if (grant.granted) return grant.origin === "direct" ? "Você ligou" : "Dono";
	return grant.kind === "permission" ? "Desligado" : "Só o dono";
}

function Permissions({ memberId }: { memberId: string }) {
	const permissions = useMemberPermissions(memberId);

	if (permissions.isPending) {
		return (
			<div className="flex h-20 items-center justify-center rounded-xl border border-border">
				<Spinner className="text-primary" />
			</div>
		);
	}
	if (permissions.isError) {
		return (
			<div className="flex flex-col items-start gap-3 rounded-xl border border-border p-4">
				<span role="alert" className="text-[13px] text-muted-foreground">
					Não deu para ler as permissões. {permissions.error.message}
				</span>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => void permissions.refetch()}
				>
					Tentar de novo
				</Button>
			</div>
		);
	}

	return (
		<ul
			aria-label="Permissões"
			className="overflow-hidden rounded-xl border border-border bg-card"
		>
			{permissions.data.map((grant) => (
				<li
					key={grant.key}
					className="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5 first:border-t-0"
				>
					{grant.granted ? (
						<CircleCheckIcon
							aria-label="Tem"
							className="size-4 shrink-0 text-success"
						/>
					) : (
						<CircleSlashIcon
							aria-label="Não tem"
							className="size-4 shrink-0 text-foreground-faint"
						/>
					)}
					<span
						className={cn(
							"min-w-0 flex-1 text-[13px]",
							grant.granted ? "text-foreground" : "text-foreground-subtle",
						)}
					>
						{grant.label}
					</span>
					<Badge
						tone={grant.granted ? "gold" : "neutral"}
						className="px-2 py-px text-[11px]"
					>
						{originLabel(grant)}
					</Badge>
				</li>
			))}
		</ul>
	);
}

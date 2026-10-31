import {
	BanIcon,
	HistoryIcon,
	KeyRoundIcon,
	TicketIcon,
	UserPlusIcon,
	UsersIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	OfflineState,
} from "@/components/ui/states";
import { useMe } from "@/features/identity";
import { type InviteView, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { type InviteRowKind, inviteRow } from "../model/history";
import { useInvites, useRevokeInvite } from "../queries";
import { useNow } from "../hooks/useNow";
import { InviteStatusPill } from "./InviteStatusPill";

/*
 * O histórico de convites (quadro "Convites" e "Painel de controle: estados"): o filtro "Valendo |
 * Todos" no próprio app, sem nova chamada, e o Revogar com a confirmação na própria linha.
 *
 * As colunas do quadro só cabem com a página larga: abaixo de 48rem (`@3xl`, a largura da página,
 * não da janela), o uso, a situação e o Revogar descem para debaixo do título.
 */

/** Quantas linhas aparecem antes do "Mostrar N mais antigos". */
const FIRST_ROWS = 6;

const ICONS: Record<InviteRowKind, { icon: ReactNode; tone: string }> = {
	person: { icon: <UserPlusIcon />, tone: "bg-info-subtle text-info-text" },
	group: { icon: <UsersIcon />, tone: "bg-violet-subtle text-violet-text" },
	recovery: { icon: <KeyRoundIcon />, tone: "bg-gold-subtle text-gold" },
};

export function InviteHistory({ newId }: { newId: string | null }) {
	const invites = useInvites();
	// "Vence em 5 minutos" anda com o relógio: um só para todas as linhas.
	const now = useNow(30_000);
	const titleId = useId();
	const [filter, setFilter] = useState<"pending" | "all">("all");
	const [showAll, setShowAll] = useState(false);

	const all = invites.data ?? [];
	const pending = all.filter((invite) => invite.status === "pending");
	const filtered = filter === "pending" ? pending : all;
	const hidden =
		filter === "all" && !showAll
			? Math.max(0, filtered.length - FIRST_ROWS)
			: 0;
	const shown = hidden > 0 ? filtered.slice(0, FIRST_ROWS) : filtered;

	return (
		<section aria-labelledby={titleId} className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<h2
					id={titleId}
					className="text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase"
				>
					Histórico
				</h2>
				{all.length > 0 && (
					<Segmented
						aria-label="Mostrar"
						value={filter}
						onValueChange={(value) => setFilter(value as "pending" | "all")}
					>
						<SegmentedItem value="pending" className="h-7">
							Valendo
							<span className="tabular-nums opacity-70">{pending.length}</span>
						</SegmentedItem>
						<SegmentedItem value="all" className="h-7">
							Todos
						</SegmentedItem>
					</Segmented>
				)}
			</div>

			<div className="overflow-hidden rounded-xl border border-border bg-card">
				{invites.isPending ? (
					<LoadingState className="py-9" />
				) : invites.isError ? (
					isApiError(invites.error, "network") ||
					isApiError(invites.error, "timeout") ? (
						<OfflineState
							className="py-9"
							onRetry={() => void invites.refetch()}
						/>
					) : (
						<ErrorState
							className="py-9"
							onRetry={() => void invites.refetch()}
						/>
					)
				) : all.length === 0 ? (
					<EmptyState
						className="py-9"
						icon={<TicketIcon />}
						title="Nenhum convite ainda"
						description="O primeiro aparece aqui assim que você criar."
					/>
				) : shown.length === 0 ? (
					<EmptyState
						className="py-9"
						icon={<TicketIcon />}
						title="Nenhum convite valendo agora"
					/>
				) : (
					<ul aria-labelledby={titleId}>
						{shown.map((invite) => (
							<InviteHistoryRow
								key={invite.id}
								invite={invite}
								now={now}
								isNew={invite.id === newId}
							/>
						))}
					</ul>
				)}
				{hidden > 0 && (
					<Button
						variant="ghost"
						className="h-[42px] w-full rounded-none border-t border-border text-link hover:text-link-hover"
						onClick={() => setShowAll(true)}
					>
						<HistoryIcon className="size-3.5" />
						Mostrar {hidden} {hidden === 1 ? "mais antigo" : "mais antigos"}
					</Button>
				)}
			</div>
		</section>
	);
}

function InviteHistoryRow({
	invite,
	now,
	isNew,
}: {
	invite: InviteView;
	now: number;
	isNew: boolean;
}) {
	const meId = useMe().data?.user.id;
	const row = inviteRow(invite, meId, now);
	const [confirming, setConfirming] = useState(false);
	const revoke = useRevokeInvite();
	const icon = ICONS[row.kind];

	function confirm() {
		revoke.mutate(invite.id, { onSettled: () => setConfirming(false) });
	}

	// O 409 é definitivo: o convite já não vale. Qualquer outra falha pode ser tentada de novo.
	const conflict = revoke.isError && isApiError(revoke.error, "conflict");
	const revokeError = revoke.isError
		? conflict
			? "Esse convite já foi usado ou venceu"
			: `Não deu para revogar. ${revoke.error.message}`
		: null;

	return (
		<li
			className={cn(
				"grid grid-cols-[38px_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 border-t border-border py-3 pr-4 pl-[18px] first:border-t-0",
				"@3xl:grid-cols-[38px_minmax(0,1fr)_200px_132px_176px]",
				isNew && "bg-primary/8",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"flex size-[38px] items-center justify-center rounded-[10px] [&>svg]:size-[17px]",
					row.pending ? icon.tone : "bg-secondary text-foreground-subtle",
				)}
			>
				{icon.icon}
			</span>
			<span className="flex min-w-0 flex-col gap-[3px]">
				<span className="flex min-w-0 items-center gap-2">
					<span
						className={cn(
							"truncate text-sm font-semibold",
							row.pending ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{row.title}
					</span>
					{isNew && (
						<span className="shrink-0 rounded-sm bg-selected px-1.5 py-px text-[10px] font-bold tracking-[0.04em] text-selected-foreground uppercase">
							Novo
						</span>
					)}
				</span>
				<span className="truncate text-xs text-muted-foreground">
					{row.subtitle}
				</span>
			</span>
			<span className="col-start-2 flex min-w-0 flex-col gap-1.5 @3xl:col-start-auto">
				<span
					className={cn(
						"truncate text-[13px]",
						row.pending
							? "text-secondary-foreground"
							: "text-foreground-subtle",
					)}
				>
					{row.usage}
				</span>
				<span
					aria-hidden="true"
					className="h-1 overflow-hidden rounded-xs bg-border"
				>
					<span
						className={cn(
							"block h-full rounded-xs",
							invite.status === "exhausted"
								? "bg-ring"
								: row.pending
									? "bg-success"
									: "bg-foreground-faint",
						)}
						style={{ width: `${row.percent}%` }}
					/>
				</span>
				{row.who && (
					<span className="truncate text-xs text-foreground-subtle">
						{row.who}
					</span>
				)}
			</span>
			<div className="col-start-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 @3xl:contents">
				<span className="flex flex-col items-start gap-1">
					<InviteStatusPill status={invite.status} />
					<span className="text-xs text-foreground-subtle">{row.note}</span>
				</span>
				<span className="flex flex-wrap items-center justify-end gap-1.5">
					{revokeError ? (
						<>
							<span
								role="alert"
								className="text-right text-xs text-destructive-text"
							>
								{revokeError}
							</span>
							{!conflict && (
								<Button
									variant="outline"
									size="sm"
									className="text-[13px] font-medium"
									onClick={() => revoke.reset()}
								>
									Tentar de novo
								</Button>
							)}
						</>
					) : confirming ? (
						<>
							<Button
								variant="ghost"
								size="sm"
								className="px-2.5 text-[13px] font-medium"
								onClick={() => setConfirming(false)}
							>
								Cancelar
							</Button>
							<Button
								variant="danger"
								size="sm"
								className="text-[13px]"
								disabled={revoke.isPending}
								onClick={confirm}
							>
								Revogar
							</Button>
						</>
					) : (
						row.pending && (
							<Button
								variant="outline"
								size="sm"
								aria-label={`Revogar ${row.title}`}
								className="text-[13px] font-medium hover:border-destructive-border hover:bg-destructive-subtle hover:text-destructive-text"
								onClick={() => setConfirming(true)}
							>
								<BanIcon className="size-3.5" />
								Revogar
							</Button>
						)
					)}
				</span>
			</div>
		</li>
	);
}

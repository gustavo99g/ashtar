import { ScrollTextIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Avatar } from "@/features/identity";
import type { AuditEntry, AuditKind } from "@/lib/api";
import {
	AUDIT_FILTERS,
	auditPhrase,
	auditPlace,
	auditWhen,
	KIND_LABEL,
} from "../model/audit";
import { useAudit } from "../queries";

/*
 * Configurações › Painel de controle › Registro (quadro "Painel de controle — registro", v0.8,
 * decisões 17 a 20): tudo o que foi feito de moderação e administração, por quem e quando, da
 * mais nova para a mais velha, de 50 em 50. Os filtros Tudo, Voz, Membros, Convites e Canais. Só o
 * dono; as ações dele também entram.
 */

const columns =
	"grid grid-cols-[120px_150px_88px_minmax(0,1fr)_120px] items-center gap-3 px-4";

export function AuditSettings() {
	const [kind, setKind] = useState<AuditKind | null>(null);
	const audit = useAudit(kind);
	return (
		<div className="@container flex w-full flex-col gap-5 py-20 pr-28 pl-32">
			<div className="flex flex-col gap-1.5">
				<h1 className="text-[22px] leading-tight font-bold text-foreground">
					Registro
				</h1>
				<p className="text-[13px] text-muted-foreground">
					Tudo o que foi feito de moderação e administração, por quem e quando.
					Só você vê. Fica guardado por 1 ano.
				</p>
			</div>
			<div className="flex items-center justify-between gap-4">
				<Segmented
					aria-label="Filtrar o registro"
					value={kind ?? "all"}
					onValueChange={(value) =>
						setKind(value === "all" ? null : (value as AuditKind))
					}
				>
					{AUDIT_FILTERS.map((filter) => (
						<SegmentedItem key={filter.label} value={filter.kind ?? "all"}>
							{filter.label}
						</SegmentedItem>
					))}
				</Segmented>
				{audit.entries && audit.entries.length > 0 && (
					<span className="font-mono text-[11px] text-muted-foreground">
						{audit.entries.length}{" "}
						{audit.entries.length === 1 ? "ação" : "ações"}
						{audit.hasNextPage ? " carregadas" : ""}
					</span>
				)}
			</div>
			{audit.isPending ? (
				<LoadingState className="py-16" />
			) : audit.isError ? (
				<ErrorState className="py-16" onRetry={() => void audit.refetch()} />
			) : !audit.entries || audit.entries.length === 0 ? (
				<EmptyState
					className="py-16"
					icon={<ScrollTextIcon />}
					title="Nada registrado"
					description="Quando alguém moderar a voz ou mexer em membros, convites e canais, aparece aqui."
				/>
			) : (
				<div className="overflow-hidden rounded-lg border border-border">
					<div
						className={`${columns} h-9 border-b border-border bg-card text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase`}
					>
						<span>Quando</span>
						<span>Quem fez</span>
						<span>Tipo</span>
						<span>O que fez</span>
						<span>Onde</span>
					</div>
					<ul aria-label="Registro">
						{audit.entries.map((entry) => (
							<AuditRow key={entry.id} entry={entry} />
						))}
					</ul>
				</div>
			)}
			{audit.hasNextPage && (
				<Button
					variant="outline"
					className="self-center"
					disabled={audit.isFetchingNextPage}
					onClick={() => void audit.fetchNextPage()}
				>
					Carregar mais
				</Button>
			)}
		</div>
	);
}

function AuditRow({ entry }: { entry: AuditEntry }) {
	return (
		<li
			className={`${columns} min-h-11 border-b border-border py-2 text-[13px] last:border-b-0`}
		>
			<span className="font-mono text-[12px] text-muted-foreground">
				{auditWhen(entry.at)}
			</span>
			<span className="flex min-w-0 items-center gap-2">
				<Avatar nick={entry.actor.name} avatar={null} size={22} />
				<span className="truncate font-semibold text-foreground">
					{entry.actor.name}
				</span>
			</span>
			<span className="text-muted-foreground">{KIND_LABEL[entry.kind]}</span>
			<span className="min-w-0 text-secondary-foreground">
				{auditPhrase(entry).map((part, index) =>
					part.strong ? (
						<strong key={index} className="font-semibold text-foreground">
							{part.text}
						</strong>
					) : (
						<span key={index}>{part.text}</span>
					),
				)}
			</span>
			<span className="truncate text-muted-foreground">{auditPlace(entry)}</span>
		</li>
	);
}

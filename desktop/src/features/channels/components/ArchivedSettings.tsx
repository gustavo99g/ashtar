import { ArchiveIcon, FolderIcon, HashIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	OfflineState,
} from "@/components/ui/states";
import { isApiError } from "@/lib/api";
import { shortDate } from "@/lib/date";
import {
	useArchivedChannels,
	useUnarchiveCategory,
	useUnarchiveChannel,
} from "../queries";

/*
 * Configurações › Servidor › Arquivados: os canais e as categorias arquivados, com Desarquivar. Só
 * aparece no menu de quem gerencia os canais; a API responde 403 aos outros.
 *
 * O canal volta para o fim da categoria em que estava (se ela ainda estiver aberta) ou do topo; a
 * categoria volta vazia, no fim da lista.
 */
export function ArchivedSettings() {
	const archived = useArchivedChannels();
	const unarchiveChannel = useUnarchiveChannel();
	const unarchiveCategory = useUnarchiveCategory();
	const error = unarchiveChannel.error ?? unarchiveCategory.error;

	return (
		<div className="flex w-full flex-col gap-5 py-20 pr-28 pl-32">
			<h1 className="text-[22px] leading-tight font-bold text-foreground">
				Arquivados
			</h1>
			{error && (
				<p role="alert" className="text-[13px] text-destructive-text">
					Não deu para desarquivar. {error.message}
				</p>
			)}
			{archived.isPending ? (
				<LoadingState className="py-16" />
			) : archived.isError ? (
				isApiError(archived.error, "network") ? (
					<OfflineState
						className="py-16"
						onRetry={() => void archived.refetch()}
					/>
				) : (
					<ErrorState
						className="py-16"
						onRetry={() => void archived.refetch()}
					/>
				)
			) : archived.data.channels.length + archived.data.categories.length ===
				0 ? (
				<EmptyState
					className="py-16"
					icon={<ArchiveIcon />}
					title="Nada arquivado"
					description="Canais e categorias arquivados aparecem aqui."
				/>
			) : (
				<ul
					aria-label="Arquivados"
					className="overflow-hidden rounded-xl border border-border bg-card"
				>
					{archived.data.categories.map((category) => (
						<Row
							key={`cat:${category.id}`}
							icon={<FolderIcon />}
							name={category.name}
							kind="Categoria"
							archivedAt={category.archived_at}
							pending={unarchiveCategory.isPending}
							onUnarchive={() => unarchiveCategory.mutate(category.id)}
						/>
					))}
					{archived.data.channels.map((channel) => (
						<Row
							key={`ch:${channel.id}`}
							icon={channel.kind === "text" ? <HashIcon /> : <Volume2Icon />}
							name={channel.name}
							kind={channel.kind === "text" ? "Canal de texto" : "Sala de voz"}
							archivedAt={channel.archived_at ?? 0}
							pending={unarchiveChannel.isPending}
							onUnarchive={() => unarchiveChannel.mutate(channel.id)}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

function Row({
	icon,
	name,
	kind,
	archivedAt,
	pending,
	onUnarchive,
}: {
	icon: React.ReactNode;
	name: string;
	kind: string;
	archivedAt: number;
	pending: boolean;
	onUnarchive: () => void;
}) {
	return (
		<li className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground [&>svg]:size-[15px]">
				{icon}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm font-semibold text-foreground">
					{name}
				</span>
				<span className="text-xs text-muted-foreground">
					{kind} · arquivado em {shortDate(archivedAt)}
				</span>
			</span>
			<Button
				size="sm"
				variant="secondary"
				disabled={pending}
				aria-label={`Desarquivar ${name}`}
				onClick={onUnarchive}
			>
				Desarquivar
			</Button>
		</li>
	);
}

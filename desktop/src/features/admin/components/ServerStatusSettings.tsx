import {
	DatabaseBackupIcon,
	HardDriveIcon,
	RefreshCwIcon,
	ServerIcon,
	type LucideIcon,
	RadioTowerIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { ago, duration, size } from "../model/format";
import { useServerStatus } from "../queries";

/*
 * Configurações › Painel de controle › Servidor (quadro "Painel de controle — servidor", v0.6,
 * decisão 21): a API, o LiveKit, o disco e o último backup. Atualiza ao abrir e no botão; sem
 * aviso nem histórico. Só o dono.
 */

/** Um backup com mais disto já é velho: o agendado roda todo dia. */
const BACKUP_STALE_SECS = 36 * 60 * 60;
/** Com menos disto livre, o disco ganha o aviso. */
const DISK_LOW_FRACTION = 0.1;

export function ServerStatusSettings() {
	const status = useServerStatus();
	const now = Math.floor(Date.now() / 1000);
	return (
		<div className="@container flex w-full flex-col gap-5 py-20 pr-28 pl-32">
			<div className="flex min-h-9 items-center justify-between gap-4">
				<h1 className="text-[22px] leading-tight font-bold text-foreground">
					Servidor
				</h1>
				<Button
					variant="outline"
					disabled={status.isFetching}
					onClick={() => void status.refetch()}
				>
					<RefreshCwIcon
						aria-hidden="true"
						className={cn("size-[15px]", status.isFetching && "animate-spin")}
					/>
					Atualizar
				</Button>
			</div>
			{status.isPending ? (
				<LoadingState className="py-16" />
			) : status.isError ? (
				<ErrorState className="py-16" onRetry={() => void status.refetch()} />
			) : (
				<div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
					<Card
						icon={ServerIcon}
						title="API"
						tone="ok"
						value={`Versão ${status.data.api.version}`}
						detail={`No ar há ${duration(status.data.api.uptime_secs)}`}
					/>
					<Card
						icon={RadioTowerIcon}
						title="LiveKit (voz)"
						tone={status.data.livekit.ok ? "ok" : "bad"}
						value={status.data.livekit.ok ? "Respondendo" : "Fora do ar"}
						detail={
							status.data.livekit.ok
								? `Respondeu em ${status.data.livekit.latency_ms} ms`
								: (status.data.livekit.error ?? "Não respondeu")
						}
					/>
					{status.data.disk ? (
						<Card
							icon={HardDriveIcon}
							title="Disco"
							tone={
								status.data.disk.free_bytes <
								status.data.disk.total_bytes * DISK_LOW_FRACTION
									? "warn"
									: "ok"
							}
							value={`${size(status.data.disk.free_bytes)} livres`}
							detail={`de ${size(status.data.disk.total_bytes)}, na pasta de dados · os arquivos ocupam ${size(status.data.files_bytes)}`}
						/>
					) : (
						<Card
							icon={HardDriveIcon}
							title="Disco"
							tone="warn"
							value="Sem informação"
							detail="O sistema do servidor não disse."
						/>
					)}
					{status.data.last_backup ? (
						<Card
							icon={DatabaseBackupIcon}
							title="Último backup"
							tone={
								now - status.data.last_backup.at > BACKUP_STALE_SECS
									? "warn"
									: "ok"
							}
							value={ago(status.data.last_backup.at, now)}
							detail={`${status.data.last_backup.name} · ${size(status.data.last_backup.size)}`}
						/>
					) : (
						<Card
							icon={DatabaseBackupIcon}
							title="Último backup"
							tone="bad"
							value="Nenhum"
							detail="A pasta data/backups está vazia."
						/>
					)}
				</div>
			)}
		</div>
	);
}

const TONES = {
	ok: "bg-success",
	warn: "bg-warning",
	bad: "bg-destructive",
};

function Card({
	icon: Icon,
	title,
	value,
	detail,
	tone,
}: {
	icon: LucideIcon;
	title: string;
	value: ReactNode;
	detail: ReactNode;
	tone: keyof typeof TONES;
}) {
	return (
		<section
			aria-label={title}
			className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3.5"
		>
			<span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
				<Icon aria-hidden="true" className="size-4" />
				{title}
				<span
					aria-hidden="true"
					className={cn("ml-auto size-2 rounded-full", TONES[tone])}
				/>
			</span>
			<span className="text-lg font-bold text-foreground">{value}</span>
			<span className="truncate text-xs text-muted-foreground">{detail}</span>
		</section>
	);
}

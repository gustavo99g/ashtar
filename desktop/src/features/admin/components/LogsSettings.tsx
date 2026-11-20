import { DownloadIcon, FileArchiveIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/ui/states";
import { Avatar } from "@/features/identity";
import { downloadLogReport, type LogReportView } from "@/lib/api";
import { size, when } from "../model/format";
import { useLogReports } from "../queries";

/*
 * Configurações › Painel de controle › Logs (quadro "Painel de controle — logs", v0.6, decisão 17):
 * os logs que os membros mandaram pelo "Enviar logs", do mais novo ao mais antigo, com quem, quando,
 * a versão, o que a pessoa escreveu e Baixar. Só o dono. Ficam 30 dias.
 */
export function LogsSettings() {
	const reports = useLogReports();
	return (
		<div className="@container flex w-full flex-col gap-5 py-20 pr-28 pl-32">
			<div className="flex flex-col gap-1.5">
				<h1 className="text-[22px] leading-tight font-bold text-foreground">
					Logs
				</h1>
				<p className="text-[13px] text-muted-foreground">
					O que os membros mandaram pelo Enviar logs, em Aplicativo. Ficam 30
					dias.
				</p>
			</div>
			{reports.isPending ? (
				<LoadingState className="py-16" />
			) : reports.isError ? (
				<ErrorState className="py-16" onRetry={() => void reports.refetch()} />
			) : reports.data.length === 0 ? (
				<EmptyState
					className="py-16"
					icon={<FileArchiveIcon />}
					title="Ninguém mandou logs"
					description="Quando alguém mandar, aparece aqui, e você recebe um aviso."
				/>
			) : (
				<ul aria-label="Logs enviados" className="flex flex-col gap-2">
					{reports.data.map((report) => (
						<LogRow key={report.id} report={report} />
					))}
				</ul>
			)}
		</div>
	);
}

function LogRow({ report }: { report: LogReportView }) {
	const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
	const name = report.display_name ?? report.nick;
	async function download() {
		setState("busy");
		try {
			const blob = await downloadLogReport(report.id);
			saveBlob(blob, `ashtar-logs-${report.nick}-${report.created_at}.zip`);
			setState("idle");
		} catch {
			setState("failed");
		}
	}
	return (
		<li className="flex items-start gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5">
			<Avatar nick={report.nick} displayName={name} size={36} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="flex flex-wrap items-baseline gap-x-2 text-sm">
					<strong className="font-semibold text-foreground">{name}</strong>
					<span className="text-xs text-muted-foreground">
						{when(report.created_at)} · Ashtar {report.app_version} ·{" "}
						{size(report.size)}
					</span>
				</span>
				{report.note ? (
					<p className="text-[13px] leading-normal break-words whitespace-pre-wrap text-secondary-foreground">
						{report.note}
					</p>
				) : (
					<p className="text-[13px] text-foreground-subtle">Sem descrição.</p>
				)}
				{state === "failed" && (
					<p role="alert" className="text-xs text-destructive-text">
						Não deu para baixar. Tente de novo.
					</p>
				)}
			</div>
			<Button
				variant="outline"
				size="sm"
				disabled={state === "busy"}
				onClick={() => void download()}
				aria-label={`Baixar os logs de ${name}`}
			>
				<DownloadIcon aria-hidden="true" className="size-3.5" />
				Baixar
			</Button>
		</li>
	);
}

/** Salva o arquivo pelo download do WebView2 (a pasta Downloads). */
function saveBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

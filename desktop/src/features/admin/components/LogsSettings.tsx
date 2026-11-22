import {
	DownloadIcon,
	EyeIcon,
	EyeOffIcon,
	FileArchiveIcon,
} from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Avatar } from "@/features/identity";
import { ApiError, type LogReportView } from "@/lib/api";
import { downloadFile } from "@/lib/tauri/commands";
import { revealFile } from "@/lib/tauri/opener";
import { cn } from "@/lib/utils";
import { size, when } from "../model/format";
import { useLogEntries, useLogReports, useLogText } from "../queries";

/*
 * Configurações › Painel de controle › Logs (quadro "Painel de controle — logs", v0.6, decisão 17):
 * os logs que os membros mandaram pelo "Enviar logs", do mais novo ao mais antigo, com quem, quando,
 * a versão, o que a pessoa escreveu, Ver e Baixar. Quem tem "Ver logs" (o dono sempre, v0.7). Ficam
 * 30 dias.
 *
 * Ver (v0.7) abre os arquivos do `.zip` ali mesmo, um de cada vez, sem baixar nada: a API abre o
 * `.zip` e manda o texto (o fim, de um log muito grande). Baixar salva o `.zip` em Downloads pelo
 * Rust, como os arquivos do chat (o download do WebView2 não salvava nada).
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
	const [busy, setBusy] = useState(false);
	const [open, setOpen] = useState(false);
	const name = report.display_name ?? report.nick;
	async function download() {
		setBusy(true);
		try {
			const path = await downloadFile(
				report.id,
				`ashtar-logs-${report.nick}-${report.created_at}.zip`,
				undefined,
				"logs",
			);
			toast.add({
				title: "Salvo em Downloads",
				description: path,
				data: { tone: "success", compact: true },
				actionProps: {
					children: "Abrir pasta",
					onClick: () => revealFile(path),
				},
			});
		} catch (error) {
			toast.add({
				title: "Não deu para baixar os logs",
				description:
					error instanceof ApiError ? error.message : "Tente de novo.",
				data: { tone: "error" },
			});
		} finally {
			setBusy(false);
		}
	}
	return (
		<li className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
			<div className="flex items-center gap-3.5">
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
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						aria-expanded={open}
						onClick={() => setOpen((value) => !value)}
						aria-label={`${open ? "Fechar" : "Ver"} os logs de ${name}`}
					>
						{open ? (
							<EyeOffIcon aria-hidden="true" className="size-3.5" />
						) : (
							<EyeIcon aria-hidden="true" className="size-3.5" />
						)}
						{open ? "Fechar" : "Ver"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void download()}
						aria-label={`Baixar os logs de ${name}`}
					>
						<DownloadIcon aria-hidden="true" className="size-3.5" />
						{busy ? "Baixando…" : "Baixar"}
					</Button>
				</div>
			</div>
			{open && <LogViewer id={report.id} />}
		</li>
	);
}

/** Os arquivos do `.zip`, um botão para cada, e o texto do escolhido. */
function LogViewer({ id }: { id: string }) {
	const entries = useLogEntries(id);
	const [picked, setPicked] = useState<string | null>(null);
	const files = entries.data ?? [];
	const current = picked ?? files[0]?.name ?? null;
	const text = useLogText(id, current);
	if (entries.isPending) {
		return (
			<div className="flex justify-center py-6">
				<Spinner />
			</div>
		);
	}
	if (entries.isError || files.length === 0) {
		return (
			<p className="py-4 text-center text-[13px] text-muted-foreground">
				{entries.isError
					? "Não deu para abrir esses logs."
					: "O .zip está vazio."}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			<div
				role="tablist"
				aria-label="Arquivos dos logs"
				className="flex flex-wrap gap-1"
			>
				{files.map((file) => (
					<button
						key={file.name}
						type="button"
						role="tab"
						aria-selected={file.name === current}
						onClick={() => setPicked(file.name)}
						className={cn(
							"rounded-md px-2 py-1 font-mono text-xs",
							file.name === current
								? "bg-selected text-selected-foreground"
								: "text-muted-foreground hover:bg-secondary hover:text-foreground",
						)}
					>
						{file.name} <span className="opacity-70">{size(file.size)}</span>
					</button>
				))}
			</div>
			{text.data?.truncated && (
				<p className="text-xs text-muted-foreground">
					O arquivo é grande: aparece só o fim dele (os 2 MB mais recentes).
					Baixe para ver inteiro.
				</p>
			)}
			<pre
				role="tabpanel"
				aria-label={current ?? undefined}
				className="max-h-[480px] overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-secondary-foreground"
			>
				{text.isPending
					? "Carregando…"
					: text.isError
						? "Não deu para abrir este arquivo."
						: text.data.text || "(vazio)"}
			</pre>
		</div>
	);
}

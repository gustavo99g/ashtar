/**
 * O "Enviar logs" e o que só o dono vê no Painel: os logs enviados e o estado do servidor (v0.6,
 * decisões 16, 17 e 21).
 */
import { apiFetch, apiJson } from "../client";
import type {
	AuditEntry,
	AuditKind,
	LogEntry,
	LogReportView,
	LogText,
	ServerStatus,
} from "../generated";

/** O envio dos logs tem até 2 minutos, como na API. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Manda o `.zip` dos logs, com o "O que aconteceu?". */
export async function sendLogs(
	zip: ArrayBuffer,
	note: string,
): Promise<LogReportView> {
	const query = note.trim() ? `?note=${encodeURIComponent(note.trim())}` : "";
	const response = await apiFetch(
		`/api/logs${query}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/zip" },
			body: zip,
		},
		UPLOAD_TIMEOUT_MS,
	);
	return (await response.json()) as LogReportView;
}

export function listLogReports(): Promise<LogReportView[]> {
	return apiJson<LogReportView[]>("/api/logs");
}

/** Os arquivos de dentro do `.zip` de um envio, para ler no app. */
export function listLogEntries(id: string): Promise<LogEntry[]> {
	return apiJson<LogEntry[]>(`/api/logs/${encodeURIComponent(id)}/entries`);
}

/** O texto de um arquivo do `.zip` (o fim dele, se for grande). */
export function readLogEntry(id: string, name: string): Promise<LogText> {
	const query = new URLSearchParams({ name });
	return apiJson<LogText>(
		`/api/logs/${encodeURIComponent(id)}/entry?${query}`,
	);
}

export function getServerStatus(): Promise<ServerStatus> {
	return apiJson<ServerStatus>("/api/admin/status");
}

/** Uma página do registro (`GET /api/admin/audit`), de 50 em 50, da mais nova para a mais velha. */
export function listAudit(
	kind: AuditKind | null,
	before?: number,
): Promise<AuditEntry[]> {
	const query = new URLSearchParams();
	if (kind) query.set("kind", kind);
	if (before !== undefined) query.set("before", String(before));
	const suffix = query.size > 0 ? `?${query}` : "";
	return apiJson<AuditEntry[]>(`/api/admin/audit${suffix}`);
}

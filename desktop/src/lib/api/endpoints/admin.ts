/**
 * O "Enviar logs" e o que só o dono vê no Painel: os logs enviados e o estado do servidor (v0.6,
 * decisões 16, 17 e 21).
 */
import { apiFetch, apiJson } from "../client";
import type { LogReportView, ServerStatus } from "../generated";

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

/** O `.zip` de um envio. */
export async function downloadLogReport(id: string): Promise<Blob> {
	const response = await apiFetch(
		`/api/logs/${encodeURIComponent(id)}`,
		{},
		UPLOAD_TIMEOUT_MS,
	);
	return response.blob();
}

export function getServerStatus(): Promise<ServerStatus> {
	return apiJson<ServerStatus>("/api/admin/status");
}

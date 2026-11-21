/**
 * O `logs.received` (só o dono recebe): a lista do Painel busca de novo, e o aviso no canto sai
 * pelo `LogsNotices`. O `disk.alert` (também só o dono, ADR 0031) vira o aviso do disco cheio.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { LogReportView, ServerEvent } from "@/lib/api";
import { adminKeys } from "./queries";

type Listener = (report: LogReportView) => void;
const listeners = new Set<Listener>();

/** Para o aviso: avisa a cada envio que chega. */
export function onLogsReceived(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export interface DiskAlert {
	free_bytes: number;
	total_bytes: number;
}
type DiskListener = (alert: DiskAlert) => void;
const diskListeners = new Set<DiskListener>();

/** Para o aviso do disco acima de 80%. */
export function onDiskAlert(listener: DiskListener): () => void {
	diskListeners.add(listener);
	return () => diskListeners.delete(listener);
}

export function handleAdminRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
): void {
	if (event.type === "disk.alert") {
		void queryClient.invalidateQueries({ queryKey: adminKeys.status() });
		for (const listener of diskListeners) listener(event);
		return;
	}
	if (event.type !== "logs.received") return;
	void queryClient.invalidateQueries({ queryKey: adminKeys.logs() });
	for (const listener of listeners) listener(event.report);
}

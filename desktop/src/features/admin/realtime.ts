/**
 * O `logs.received` (só o dono recebe): a lista do Painel busca de novo, e o aviso no canto sai
 * pelo `LogsNotices`.
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

export function handleAdminRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
): void {
	if (event.type !== "logs.received") return;
	void queryClient.invalidateQueries({ queryKey: adminKeys.logs() });
	for (const listener of listeners) listener(event.report);
}

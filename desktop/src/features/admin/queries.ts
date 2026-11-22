import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getServerStatus,
	listLogEntries,
	listLogReports,
	readLogEntry,
	sendLogs,
} from "@/lib/api";
import { logsBundle } from "@/lib/tauri/commands";

export const adminKeys = {
	logs: () => ["admin", "logs"] as const,
	status: () => ["admin", "status"] as const,
	entries: (id: string) => ["admin", "logs", id, "entries"] as const,
	entry: (id: string, name: string) =>
		["admin", "logs", id, "entry", name] as const,
};

/** Os arquivos de dentro de um envio. Não mudam: busca uma vez. */
export function useLogEntries(id: string) {
	return useQuery({
		queryKey: adminKeys.entries(id),
		queryFn: () => listLogEntries(id),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/** O texto de um arquivo de um envio. */
export function useLogText(id: string, name: string | null) {
	return useQuery({
		queryKey: adminKeys.entry(id, name ?? ""),
		queryFn: () => readLogEntry(id, name ?? ""),
		enabled: name !== null,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/** Os logs enviados, para o Painel. Só com "Ver logs". */
export function useLogReports() {
	return useQuery({ queryKey: adminKeys.logs(), queryFn: listLogReports });
}

/** O estado do servidor, ao abrir a tela e no Atualizar. Sem perguntar sozinho. */
export function useServerStatus() {
	return useQuery({
		queryKey: adminKeys.status(),
		queryFn: getServerStatus,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

/** Junta os logs no Rust e manda para a API. */
export function useSendLogs() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (note: string) => sendLogs(await logsBundle(), note),
		onSuccess: () =>
			void queryClient.invalidateQueries({ queryKey: adminKeys.logs() }),
	});
}

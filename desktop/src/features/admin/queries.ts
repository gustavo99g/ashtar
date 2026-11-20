import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getServerStatus,
	listLogReports,
	sendLogs,
} from "@/lib/api";
import { logsBundle } from "@/lib/tauri/commands";

export const adminKeys = {
	logs: () => ["admin", "logs"] as const,
	status: () => ["admin", "status"] as const,
};

/** Os logs enviados, para o Painel. Só o dono. */
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

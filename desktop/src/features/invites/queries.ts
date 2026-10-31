/**
 * O cache da API para os convites (TanStack Query). As chaves ficam em `invitesKeys`, para quem lê
 * o cache ou o invalida não escrever o array à mão. O histórico e a revogação são do Painel
 * (Etapa 7).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/identity";
import {
	type CreateInviteRequest,
	createInvite,
	listInvites,
	revokeInvite,
} from "@/lib/api";
import { forgetQuickInvite } from "./quickInvite";

export const invitesKeys = {
	all: ["invites"] as const,
	list: () => [...invitesKeys.all, "list"] as const,
};

/**
 * Cria um convite pelo modelo (`POST /api/invites`): `mutate({ preset: "group" })`. O código e o
 * link só vêm nesta resposta. O histórico ganhou uma linha: a lista fica velha.
 */
export function useCreateInvite() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (request: CreateInviteRequest) => createInvite(request),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: invitesKeys.list() }),
	});
}

/** O histórico (`GET /api/invites`), do mais novo para o mais antigo. Só com a sessão conectada. */
export function useInvites() {
	const connected = useSession().status === "connected";
	return useQuery({
		queryKey: invitesKeys.list(),
		queryFn: listInvites,
		enabled: connected,
	});
}

/**
 * Revoga um convite (`POST /api/invites/{id}/revoke`): `mutate(id)`. Um convite que já não vale
 * rejeita com `conflict` (409). Nos dois casos a lista está velha. Se era o convite rápido da
 * sala, ele some de lá também, para o Convidar não mostrar um convite revogado.
 */
export function useRevokeInvite() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => revokeInvite(id),
		onSuccess: (_data, id) => forgetQuickInvite(id),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: invitesKeys.list() }),
	});
}

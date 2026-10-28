/**
 * O cache da API para os convites (TanStack Query). As chaves ficam em `invitesKeys`, para quem lê
 * o cache ou o invalida não escrever o array à mão. A etapa 7 acrescenta aqui o histórico e a
 * revogação, que o Painel usa.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type CreateInviteRequest, createInvite } from "@/lib/api";

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

/**
 * O cache da API para os membros (TanStack Query). As chaves ficam em `membersKeys`, para quem lê
 * o cache ou o invalida não escrever o array à mão. A lista é uma chamada só: os chips filtram no
 * app, e o aviso de quem entrou repete a mesma consulta.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/identity";
import { listMembers, type MemberView, setMemberBeta } from "@/lib/api";

export const membersKeys = {
	all: ["members"] as const,
	list: () => [...membersKeys.all, "list"] as const,
	permissions: (id: string) => [...membersKeys.all, "permissions", id] as const,
};

/** Todos os membros (`GET /api/members`), os removidos inclusive. Só com a sessão conectada. */
export function useMembers() {
	const connected = useSession().status === "connected";
	return useQuery({
		queryKey: membersKeys.list(),
		queryFn: listMembers,
		enabled: connected,
	});
}

/**
 * Liga ou desliga o beta de alguém (`PUT /api/members/{id}/beta`): `mutate({ id, enabled })`.
 * A chave muda na hora (o cache é atualizado antes da resposta) e volta se a API recusar.
 */
export function useSetMemberBeta() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			setMemberBeta(id, enabled),
		onMutate: async ({ id, enabled }) => {
			await queryClient.cancelQueries({ queryKey: membersKeys.list() });
			const before = queryClient.getQueryData<MemberView[]>(membersKeys.list());
			queryClient.setQueryData<MemberView[]>(membersKeys.list(), (list) =>
				list?.map((member) =>
					member.id === id
						? {
								...member,
								beta: enabled
									? {
											origin: "direct",
											granted_at: Math.floor(Date.now() / 1000),
										}
									: null,
							}
						: member,
				),
			);
			return { before };
		},
		onError: (_error, _variables, result) => {
			if (result?.before)
				queryClient.setQueryData(membersKeys.list(), result.before);
		},
		onSettled: (_data, _error, { id }) =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: membersKeys.list() }),
				queryClient.invalidateQueries({
					queryKey: membersKeys.permissions(id),
				}),
			]),
	});
}

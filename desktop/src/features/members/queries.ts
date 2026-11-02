/**
 * O cache da API para os membros (TanStack Query). As chaves ficam em `membersKeys`, para quem lê
 * o cache ou o invalida não escrever o array à mão. A lista é uma chamada só: os chips filtram no
 * app, e o aviso de quem entrou repete a mesma consulta.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe, useSession } from "@/features/identity";
import { invitesKeys } from "@/features/invites";
import {
	createRecoveryInvite,
	type GrantView,
	getMemberPermissions,
	listMembers,
	type MemberView,
	removeMember,
	setMemberBeta,
	setMemberPermission,
	unlinkMember,
} from "@/lib/api";
import { useRealtimeOpen } from "@/lib/realtime";
import { useAppVisible } from "@/lib/visibility";

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
 * De quanto em quanto tempo o app do dono pergunta de novo, para o aviso de quem entrou. Só com o
 * tempo real fora: aberto, o `member.joined` avisa (`realtime.ts`).
 */
export const MEMBERS_WATCH_MS = 30_000;

/**
 * A mesma lista, repetida a cada 30 segundos enquanto o app está à vista, para o aviso de quem
 * entrou. Só com `can_view_panel`: quem não pode ver o Painel não pergunta. A chave é a da lista,
 * então a tela Membros e o aviso dividem o cache: o que um busca, o outro vê.
 */
export function useMembersWatch() {
	const visible = useAppVisible();
	const connected = useSession().status === "connected";
	const canView = useMe().data?.can_view_panel === true;
	const live = useRealtimeOpen();
	return useQuery({
		queryKey: membersKeys.list(),
		queryFn: listMembers,
		enabled: connected && canView,
		refetchInterval: visible && !live ? MEMBERS_WATCH_MS : false,
	});
}

/** As permissões de um membro, como a API devolve (`GET /api/members/{id}/permissions`). */
export function useMemberPermissions(id: string | null) {
	return useQuery({
		queryKey: membersKeys.permissions(id ?? ""),
		queryFn: () => getMemberPermissions(id ?? ""),
		enabled: id !== null,
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

/**
 * Liga ou desliga uma permissão de alguém (`PUT /api/members/{id}/permissions/{key}`):
 * `mutate({ id, key, enabled })`. Como o beta, a chave muda na hora e volta se a API recusar. O
 * beta também é uma permissão, então a lista (a coluna Beta) é recarregada junto.
 */
export function useSetMemberPermission() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			key,
			enabled,
		}: {
			id: string;
			key: string;
			enabled: boolean;
		}) => setMemberPermission(id, key, enabled),
		onMutate: async ({ id, key, enabled }) => {
			const queryKey = membersKeys.permissions(id);
			await queryClient.cancelQueries({ queryKey });
			const before = queryClient.getQueryData<GrantView[]>(queryKey);
			queryClient.setQueryData<GrantView[]>(queryKey, (list) =>
				list?.map((grant) =>
					grant.key === key
						? {
								...grant,
								granted: enabled,
								origin: enabled ? "direct" : null,
								granted_at: enabled ? Math.floor(Date.now() / 1000) : null,
							}
						: grant,
				),
			);
			return { before };
		},
		onError: (_error, { id }, result) => {
			if (result?.before)
				queryClient.setQueryData(membersKeys.permissions(id), result.before);
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

/** Tira o computador do membro (`POST /api/members/{id}/unlink`): ele fica "Sem computador". */
export function useUnlinkMember() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => unlinkMember(id),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: membersKeys.list() }),
	});
}

/**
 * Cria o convite de recuperação de alguém (`POST /api/members/{id}/recovery-invite`). O código só
 * vem nesta resposta. O membro passa a ter "Recuperação valendo até..." e o histórico de convites
 * ganha uma linha.
 */
export function useCreateRecoveryInvite() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => createRecoveryInvite(id),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: membersKeys.list() }),
				queryClient.invalidateQueries({ queryKey: invitesKeys.list() }),
			]),
	});
}

/**
 * Remove alguém do grupo (`DELETE /api/members/{id}`). A API também revoga as recuperações dele
 * que ainda valiam, então o histórico de convites muda junto.
 */
export function useRemoveMember() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => removeMember(id),
		onSettled: (_data, _error, id) =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: membersKeys.list() }),
				queryClient.invalidateQueries({
					queryKey: membersKeys.permissions(id),
				}),
				queryClient.invalidateQueries({ queryKey: invitesKeys.list() }),
			]),
	});
}

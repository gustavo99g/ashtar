/**
 * O cache da API para a identidade (TanStack Query): quem está usando e o convite lido pelo
 * código. As chaves ficam em `identityKeys`, para quem lê o cache ou o invalida não escrever o
 * array à mão.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getInvite, getMe, updateMe } from "@/lib/api";
import { redeemInvite, useSession } from "./stores/sessionStore";

/**
 * Esquece tudo o que a API devolveu (de todos os domínios): quando este computador sai do grupo, o
 * que estava no cache já não é desta pessoa. Devolve a função, para o `SessionWatcher` chamar.
 */
export function useClearCache() {
	const queryClient = useQueryClient();
	return useCallback(() => queryClient.clear(), [queryClient]);
}

export const identityKeys = {
	all: ["identity"] as const,
	me: () => [...identityKeys.all, "me"] as const,
	invite: (code: string) => [...identityKeys.all, "invite", code] as const,
};

/**
 * Quem está usando (`GET /api/me`): o usuário, as permissões, o canal de atualização,
 * `can_create_invite` e `can_view_panel`. Só busca com a sessão conectada.
 */
export function useMe() {
	const connected = useSession().status === "connected";
	return useQuery({
		queryKey: identityKeys.me(),
		queryFn: getMe,
		enabled: connected,
	});
}

/**
 * O convite pelo código (`GET /api/invites/{código}`), sem sessão: quem convidou (convite novo) ou
 * de quem é a conta (recuperação). Com `null`, não busca. Um convite que não vale mais rejeita
 * com `invalid_invite`, sem nova tentativa.
 */
export function useInvitePreview(code: string | null) {
	return useQuery({
		queryKey: identityKeys.invite(code ?? ""),
		queryFn: () => getInvite(code ?? ""),
		enabled: code !== null,
		// Cada falha deste convite conta no limite de tentativas da API, que é um só para todos:
		// nada de buscar de novo ao voltar o foco da janela, nem de repetir um convite que não vale.
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
	});
}

/** Entrar com um convite: `mutate({ code, nick })`, com `nick: null` na recuperação. */
export function useRedeemInvite() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ code, nick }: { code: string; nick: string | null }) =>
			redeemInvite(code, nick),
		// Uma conta nova (ou a recuperada) não aproveita nada que estava no cache.
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: identityKeys.me() }),
	});
}

/**
 * Trocar o nome visível (`PATCH /api/me`): `mutate(nome)`, com `null` ou vazio para voltar ao
 * nick. A resposta é o mesmo corpo do `GET /api/me` e entra direto no cache do `useMe`.
 */
export function useUpdateMe() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (displayName: string | null) =>
			updateMe({ display_name: displayName }),
		onSuccess: (me) => queryClient.setQueryData(identityKeys.me(), me),
	});
}

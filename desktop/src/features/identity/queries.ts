/**
 * O cache da API para a identidade (TanStack Query): quem está usando e o convite lido pelo
 * código. As chaves ficam em `identityKeys`, para quem lê o cache ou o invalida não escrever o
 * array à mão.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
	getInvite,
	getMe,
	type MeResponse,
	removeAvatar,
	type Status,
	setAvatar,
	setStatus,
	updateMe,
	uploadFile,
} from "@/lib/api";
import { clearFileCache } from "@/lib/fileCache";
import { useOptionalQueryClient } from "@/lib/query";
import { AVATAR_OUTPUT } from "./model/avatarCrop";
import { clearAvatars, rememberAvatars } from "./stores/avatarStore";
import { redeemInvite, useSession } from "./stores/sessionStore";
import { rememberStatus, useLastStatus } from "./stores/statusStore";

/**
 * Esquece tudo o que a API devolveu (de todos os domínios): quando este computador sai do grupo, o
 * que estava no cache já não é desta pessoa. Devolve a função, para o `SessionWatcher` chamar.
 */
export function useClearCache() {
	const queryClient = useQueryClient();
	return useCallback(() => {
		queryClient.clear();
		clearFileCache();
		clearAvatars();
	}, [queryClient]);
}

/** O `/api/me`, guardando a minha foto para o `Avatar`. */
async function fetchMe(): Promise<MeResponse> {
	const me = await getMe();
	rememberAvatars([me.user]);
	return me;
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
		queryFn: fetchMe,
		enabled: connected,
	});
}

/**
 * O `/api/me` para quem só precisa de uma permissão de enfeite (mostrar ou esconder um botão): o
 * mesmo do `useMe`, mas sem quebrar fora do `QueryClientProvider`.
 */
export function useOptionalMe(): MeResponse | undefined {
	const connected = useSession().status === "connected";
	const { client, present } = useOptionalQueryClient();
	return useQuery(
		{
			queryKey: identityKeys.me(),
			queryFn: fetchMe,
			enabled: connected && present,
		},
		client,
	).data;
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

/**
 * Troca a foto de perfil: envia a imagem já recortada (`kind=avatar`) e liga ela ao perfil. Com
 * `null`, tira a foto. Quem vê recebe o `user.updated`; aqui, o `/api/me` em cache já muda.
 */
export function useChangeAvatar() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (image: Blob | null) => {
			if (!image) return removeAvatar();
			const extension = image.type === "image/webp" ? "webp" : "png";
			const file = await uploadFile(image, {
				kind: "avatar",
				name: `foto.${extension}`,
				width: AVATAR_OUTPUT,
				height: AVATAR_OUTPUT,
			});
			return setAvatar(file.id);
		},
		onSuccess: (me) => {
			queryClient.setQueryData(identityKeys.me(), me);
			rememberAvatars([me.user]);
		},
	});
}

/**
 * O status de quem está usando: o do `GET /api/me` e, antes de ele chegar, o último que este
 * computador viu. Cada resposta nova fica guardada para a próxima abertura.
 */
export function useMyStatus(): Status {
	const { data: me } = useMe();
	const last = useLastStatus((state) => state.last);
	const status = me?.status;
	useEffect(() => {
		if (status) rememberStatus(status);
	}, [status]);
	return status ?? last;
}

/** Troca o status do `/api/me` em cache, sem pedido (o tempo real e a troca otimista). */
export function setCachedStatus(
	queryClient: ReturnType<typeof useQueryClient>,
	status: Status,
): void {
	queryClient.setQueryData<MeResponse>(identityKeys.me(), (me) =>
		me ? { ...me, status } : me,
	);
	rememberStatus(status);
}

/**
 * Trocar o status (`PUT /api/me/status`): muda na hora no painel e, se a API recusar, volta como
 * estava.
 */
export function useSetStatus() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (status: Status) => setStatus(status),
		onMutate: (status) => {
			const before = queryClient.getQueryData<MeResponse>(identityKeys.me())?.status;
			setCachedStatus(queryClient, status);
			return { before };
		},
		onError: (_error, _status, context) => {
			if (context?.before) setCachedStatus(queryClient, context.before);
		},
		onSuccess: (me) => {
			queryClient.setQueryData(identityKeys.me(), me);
			rememberStatus(me.status);
		},
	});
}

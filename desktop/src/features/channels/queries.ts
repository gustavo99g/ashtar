/**
 * O cache da API para os canais (TanStack Query): a lista com o topo e as categorias, os
 * arquivados e as mudanças. Toda mudança termina invalidando a lista (e os arquivados); o
 * `channels.changed` do tempo real (`realtime.ts`) faz o mesmo nos apps dos outros.
 *
 * Reordenar muda a lista na hora (antes da resposta) e volta se a API recusar. O 409 quer dizer que
 * outra pessoa mexeu antes: a lista é buscada de novo e o aviso diz para conferir.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { useMe, useSession } from "@/features/identity";
import {
	archiveCategory,
	archiveChannel,
	type CreateChannelRequest,
	createCategory,
	createChannel,
	getArchivedChannels,
	getChannelLayout,
	isApiError,
	type Layout,
	renameCategory,
	setChannelLayout,
	type UpdateChannelRequest,
	unarchiveCategory,
	unarchiveChannel,
	updateChannel,
} from "@/lib/api";
import { layoutRequest } from "./model/tree";

export const channelsKeys = {
	all: ["channels"] as const,
	layout: () => [...channelsKeys.all, "layout"] as const,
	archived: () => [...channelsKeys.all, "archived"] as const,
};

/** A lista de canais (`GET /api/channels`). Só com a sessão conectada. */
export function useChannelLayout() {
	const connected = useSession().status === "connected";
	return useQuery({
		queryKey: channelsKeys.layout(),
		queryFn: getChannelLayout,
		enabled: connected,
	});
}

/** Se quem usa pode criar, editar, arquivar e arrastar (`can_manage_channels`). */
export function useCanManageChannels(): boolean {
	return useMe().data?.can_manage_channels === true;
}

/** Os arquivados (`GET /api/channels/archived`), para a tela das configurações. */
export function useArchivedChannels() {
	const connected = useSession().status === "connected";
	return useQuery({
		queryKey: channelsKeys.archived(),
		queryFn: getArchivedChannels,
		enabled: connected,
	});
}

/** A lista e os arquivados, de novo. */
function useRefreshChannels() {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: channelsKeys.layout() }),
			queryClient.invalidateQueries({ queryKey: channelsKeys.archived() }),
		]);
}

/** Grava a ordem nova (`mutate(layoutNovo)`): muda na hora e volta se a API recusar. */
export function useSetLayout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (next: Layout) => setChannelLayout(layoutRequest(next)),
		onMutate: async (next) => {
			await queryClient.cancelQueries({ queryKey: channelsKeys.layout() });
			const before = queryClient.getQueryData<Layout>(channelsKeys.layout());
			queryClient.setQueryData(channelsKeys.layout(), next);
			return { before };
		},
		onSuccess: (saved) =>
			queryClient.setQueryData(channelsKeys.layout(), saved),
		onError: (error, _next, result) => {
			if (result?.before)
				queryClient.setQueryData(channelsKeys.layout(), result.before);
			void queryClient.invalidateQueries({ queryKey: channelsKeys.layout() });
			toast.add({
				title: isApiError(error, "conflict")
					? "A lista de canais mudou"
					: "Não deu para mudar a ordem",
				description: isApiError(error, "conflict")
					? "Outra pessoa mexeu ao mesmo tempo. Confira e tente de novo."
					: error.message,
			});
		},
	});
}

export function useCreateChannel() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: (request: CreateChannelRequest) => createChannel(request),
		onSettled: refresh,
	});
}

export function useUpdateChannel() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: ({ id, ...request }: UpdateChannelRequest & { id: string }) =>
			updateChannel(id, request),
		onSettled: refresh,
	});
}

export function useArchiveChannel() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: (id: string) => archiveChannel(id),
		onSettled: refresh,
	});
}

export function useUnarchiveChannel() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: (id: string) => unarchiveChannel(id),
		onSettled: refresh,
	});
}

export function useCreateCategory() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: (name: string) => createCategory({ name }),
		onSettled: refresh,
	});
}

export function useRenameCategory() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) =>
			renameCategory(id, { name }),
		onSettled: refresh,
	});
}

export function useArchiveCategory() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: (id: string) => archiveCategory(id),
		onSettled: refresh,
	});
}

export function useUnarchiveCategory() {
	const refresh = useRefreshChannels();
	return useMutation({
		mutationFn: (id: string) => unarchiveCategory(id),
		onSettled: refresh,
	});
}

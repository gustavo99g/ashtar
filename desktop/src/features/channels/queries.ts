/**
 * O cache da API para os canais (TanStack Query): a lista com o topo e as categorias. Quem mexe
 * na lista (Etapa 7) e o `channels.changed` do tempo real (`realtime.ts`) trocam ou invalidam esta
 * mesma chave.
 */
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/identity";
import { getChannelLayout } from "@/lib/api";

export const channelsKeys = {
	all: ["channels"] as const,
	layout: () => [...channelsKeys.all, "layout"] as const,
};

/** A lista de canais (`GET /api/channels`). Só com a sessão conectada. */
export function useChannelLayout() {
	const connected = useSession().status === "connected";
	return useQuery({
		queryKey: channelsKeys.layout(),
		queryFn: getChannelLayout,
		enabled: connected,
		// Sem tempo real, a lista também não muda sozinha: 30 s de cache como o resto.
	});
}

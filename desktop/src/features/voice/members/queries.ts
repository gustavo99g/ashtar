/**
 * O cache da API para a voz (TanStack Query): quem está na sala, visto de fora dela. Dentro da
 * chamada a lista vem do próprio LiveKit, sem perguntar à API. Com o tempo real aberto, a lista
 * chega pelo `voice.participants` (`realtime.ts`) e a consulta de 5 em 5 segundos para.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSession } from "@/features/identity";
import { listVoiceParticipants } from "@/lib/api";
import { useRealtimeOpen } from "@/lib/realtime";
import { useAppVisible } from "@/lib/visibility";

export const voiceKeys = {
	all: ["voice"] as const,
	participants: (channelId: string) =>
		[...voiceKeys.all, "participants", channelId] as const,
};

/** De quanto em quanto tempo a tela pergunta quem está na sala, com o tempo real fora. */
export const PARTICIPANTS_REFRESH_MS = 5_000;

/**
 * Quem está na sala (`GET /api/voice/participants`). Com o tempo real fora, de 5 em 5 segundos
 * enquanto o app está à vista. Minimizado ou escondido, para; ao voltar, busca na hora. Com `enabled: false` (quando a
 * lista vier do LiveKit, dentro da chamada), não pergunta.
 */
export function useVoiceParticipants(
	channelId: string,
	{ enabled = true } = {},
) {
	const visible = useAppVisible();
	const connected = useSession().status === "connected";
	const live = useRealtimeOpen();
	const query = useQuery({
		queryKey: voiceKeys.participants(channelId),
		queryFn: () => listVoiceParticipants(channelId),
		enabled: connected && enabled,
		// A lista muda sozinha: o que veio há 5 s já está velho.
		staleTime: 0,
		refetchInterval: visible && !live ? PARTICIPANTS_REFRESH_MS : false,
	});

	const { refetch } = query;
	const wasVisible = useRef(visible);
	useEffect(() => {
		if (visible && !wasVisible.current && connected && enabled) {
			void refetch({ cancelRefetch: false });
		}
		wasVisible.current = visible;
	}, [visible, connected, enabled, refetch]);

	return query;
}

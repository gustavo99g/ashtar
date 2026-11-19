import { useEffect } from "react";
import { useAppFocused } from "@/lib/visibility";
import { markChannelRead, useReadState } from "../store";

/** Quanto o pedido espera: mensagens seguidas nesse tempo saem num pedido só. */
export const MARK_READ_DELAY_MS = 1_000;

/**
 * Dá o canal (ou a conversa) como lido enquanto a pessoa está de fato lendo: a tela dele aberta (é
 * quem chama), a janela do app em foco e o fim do histórico à vista (`seeingEnd`). Com o app na
 * bandeja, sem foco ou com a pessoa lá em cima no histórico, não marca.
 *
 * O pedido espera `MARK_READ_DELAY_MS`; uma mensagem nova nesse meio recomeça a espera, e o pedido
 * que sai leva a mais nova.
 */
export function useMarkRead(
	channelId: string,
	lastMessageId: string | undefined,
	seeingEnd: boolean,
): void {
	const focused = useAppFocused();
	const { last_read_id } = useReadState(channelId);
	const behind =
		lastMessageId !== undefined &&
		(last_read_id === null || lastMessageId > last_read_id);

	useEffect(() => {
		if (!focused || !seeingEnd || !behind || lastMessageId === undefined) return;
		const timer = setTimeout(
			() => void markChannelRead(channelId, lastMessageId),
			MARK_READ_DELAY_MS,
		);
		return () => clearTimeout(timer);
	}, [channelId, lastMessageId, seeingEnd, focused, behind]);
}

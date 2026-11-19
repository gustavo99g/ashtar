import { useEffect, useState } from "react";
import { useReadState } from "../store";

/**
 * Onde fica a linha "Novas mensagens" de uma conversa: depois da mensagem com este id (`null`: antes
 * da primeira), ou `undefined` sem linha.
 *
 * O lugar é o ponteiro de quando havia não lidas à vista: ao abrir o canal, ou quando chegou
 * mensagem com a pessoa sem estar lendo (`reading` falso: o app sem foco, ou ela lá em cima no
 * histórico). Mensagem chegando enquanto ela lê não cria linha. Depois de posta, a linha não anda:
 * fica até a pessoa sair do canal (quem usa monta um por canal, com `key`).
 */
export function useUnreadMarker(
	channelId: string,
	reading: boolean,
): string | null | undefined {
	const { last_read_id, unread } = useReadState(channelId);
	const [after, setAfter] = useState<string | null | undefined>(() =>
		unread > 0 ? last_read_id : undefined,
	);

	useEffect(() => {
		if (after === undefined && unread > 0 && !reading) setAfter(last_read_id);
	}, [after, unread, reading, last_read_id]);

	return after;
}

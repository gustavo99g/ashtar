import { SALA } from "./channel";
import { type ChannelMember, memberFromApi } from "./members";
import { useVoiceParticipants } from "./queries";
import { useVoice } from "./useVoice";

/**
 * Quem está na sala, pela lista da API (de 5 em 5 segundos, com o app à vista).
 *
 * A lista vale também durante a chamada: ainda não há uma lista vinda do LiveKit para a coluna,
 * e sem consultar a API ela ficaria parada na última lista. Quando houver (com o estado de falando,
 * mutado e deafen de quem está dentro), é aqui que a fonte troca, e a consulta passa a usar
 * `{ enabled: !inCall }`.
 */
export function useChannelMembers(): {
	members: ChannelMember[];
	inCall: boolean;
} {
	const { voiceChannelId } = useVoice();
	const inCall = voiceChannelId === SALA.id;
	const { data } = useVoiceParticipants(SALA.id);
	return { members: data?.map(memberFromApi) ?? [], inCall };
}

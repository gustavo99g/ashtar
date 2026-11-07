/**
 * O último canal de texto aberto neste computador. Ao abrir o app (e ao voltar das
 * configurações ou da sala), a tela do servidor abre nele. Fica no `localStorage`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** O canal de quem nunca abriu outro, e o de quando o último foi arquivado. */
export const DEFAULT_CHANNEL_ID = "geral";

interface LastChannelState {
	channelId: string;
}

export const useLastChannel = create<LastChannelState>()(
	persist(() => ({ channelId: DEFAULT_CHANNEL_ID }), {
		name: "ashtar-last-channel",
		version: 1,
	}),
);

export function setLastChannel(channelId: string): void {
	if (useLastChannel.getState().channelId === channelId) return;
	useLastChannel.setState({ channelId });
}

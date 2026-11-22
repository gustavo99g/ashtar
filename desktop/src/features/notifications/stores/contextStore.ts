/**
 * O que a janela principal sabe agora e a regra (`model/decide.ts`) precisa: o status, se o app
 * está em foco, o que está aberto e em que sala a pessoa está. Quem enche é o `NotificationsBridge`,
 * que vive na moldura do app; quem lê é o `realtime.ts`, fora do React.
 *
 * Não fica no disco: tudo isso vale só enquanto o app está aberto.
 */
import { create } from "zustand";
import type { Status } from "@/lib/api";

export interface NotificationContext {
	status: Status;
	/** A janela principal está à vista e em foco. */
	focused: boolean;
	/** O canal de texto aberto no meio da tela. */
	channelId: string | null;
	/** A conversa privada expandida embaixo. */
	dmId: string | null;
	/** A sala de voz em que a pessoa está. */
	voiceChannelId: string | null;
}

export const INITIAL_CONTEXT: NotificationContext = {
	status: "available",
	focused: false,
	channelId: null,
	dmId: null,
	voiceChannelId: null,
};

export const useNotificationContext = create<NotificationContext>()(
	() => INITIAL_CONTEXT,
);

export function setNotificationContext(
	context: Partial<NotificationContext>,
): void {
	useNotificationContext.setState(context);
}

/** Se a pessoa já está vendo este canal ou conversa. */
export function isViewing(
	context: NotificationContext,
	channelId: string,
): boolean {
	return (
		context.focused &&
		(context.channelId === channelId || context.dmId === channelId)
	);
}

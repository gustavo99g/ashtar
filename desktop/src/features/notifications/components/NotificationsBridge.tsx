/**
 * A ponta dos avisos na janela principal. Não desenha nada; fica uma vez, na moldura do app
 * (`AppShell`), porque precisa do router e da voz.
 *
 * - Mantém o `contextStore` em dia (status, foco, o que está aberto, a sala), para a regra.
 * - Acende e apaga o ponto na bandeja e na barra de tarefas: vermelho com conversa privada com não
 *   lida, ou menção em qualquer lugar (canal comum com não lidas não acende); dourado transmitindo
 *   a tela, no lugar do vermelho (v0.8).
 * - Recebe o clique num cartão e abre o que ele aponta.
 */
import { useEffect } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { showDm, useDmsUnread, useOpenDms } from "@/features/dms";
import { useMyStatus } from "@/features/identity";
import { useUnreadStore } from "@/features/unread";
import { useVoice, useVoiceChannelId, watchShare } from "@/features/voice";
import { paths } from "@/lib/paths";
import { useScreenShareState } from "@/features/screen-share";
import { onNotificationOpen, setAppBadge } from "@/lib/tauri/commands";
import { useAppFocused } from "@/lib/visibility";
import { type CardTarget, parseTarget } from "../model/cards";
import { setNotificationContext } from "../stores/contextStore";

export function NotificationsBridge() {
	useContextSync();
	useAppBadge();
	useOpenTarget();
	return null;
}

function useContextSync() {
	const status = useMyStatus();
	const focused = useAppFocused();
	const channelId = useMatch(paths.channelPattern)?.params.channelId ?? null;
	const dmId = useOpenDms((state) => state.active);
	const voiceChannelId = useVoiceChannelId();

	useEffect(() => {
		setNotificationContext({ status, focused, channelId, dmId, voiceChannelId });
	}, [status, focused, channelId, dmId, voiceChannelId]);
}

function useAppBadge() {
	const dms = useDmsUnread();
	const mentions = useUnreadStore((store) =>
		Object.values(store.byChannel).some((state) => state.mentions > 0),
	);
	const { screenShare } = useVoice();
	const sharing = useScreenShareState(screenShare).status === "active";
	const badge = sharing ? "sharing" : dms > 0 || mentions ? "unread" : "none";

	useEffect(() => {
		void setAppBadge(badge).catch(() => {});
	}, [badge]);
}

function useOpenTarget() {
	const navigate = useNavigate();
	const { join } = useVoice();

	useEffect(() => {
		const open = (target: CardTarget) => {
			switch (target.kind) {
				case "dm":
					showDm(target.channelId);
					break;
				case "channel":
					void navigate(paths.channel(target.channelId));
					break;
				case "stream":
					// Entra na sala já assistindo, como o "Assistir" da tela da sala.
					join(target.channelId);
					watchShare(target.userId);
					void navigate(paths.voiceRoom);
					break;
				case "app":
					// O Rust já trouxe a janela.
					break;
			}
		};
		const stop = onNotificationOpen((value) => {
			const target = parseTarget(value);
			if (target) open(target);
		});
		return () => void stop.then((unlisten) => unlisten());
	}, [navigate, join]);
}

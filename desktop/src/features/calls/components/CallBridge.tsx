/**
 * A ponta das ligações na janela principal (Etapa 20 da v0.3, ADR 0023). Não desenha nada; fica
 * uma vez, na moldura do app (`AppShell`), porque precisa da voz e do router.
 *
 * - **A voz segue a ligação.** Atendida, sai da sala em que estava (guardando qual, para o
 *   "Voltar para a sala") e entra na sala da conversa, na tela da sala (`/room`). Uma conexão de
 *   voz por vez (decisão 24): entrar na ligação desliga a sala e a transmissão. Se a pessoa sai da
 *   sala da ligação (Desligar, ou entrou noutra sala), a ligação acaba para os dois. Quando a
 *   ligação acaba do outro lado, a voz sai, e a tela volta para a conversa.
 * - **O cartão da ligação** vai para a janela dos avisos enquanto toca, a não ser em Ocupado.
 * - **Os botões do cartão** voltam por aqui: Atender, Recusar e Responder com mensagem.
 *
 * Abrir a conversa é da `features/dms`, que importa esta: quem monta passa o `showConversation`.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMyStatus } from "@/features/identity";
import { useScreenShareState } from "@/features/screen-share";
import { stopWatching, useVoice } from "@/features/voice";
import { paths } from "@/lib/paths";
import {
	notificationRing,
	onNotificationAnswer,
} from "@/lib/tauri/commands";
import { acceptRinging, declineRinging, hangUp } from "../actions";
import { otherPerson, personName } from "../model/machine";
import { parseAnswer, ringCard } from "../model/ring";
import {
	markConnected,
	setReturnRoom,
	useCallStore,
} from "../stores/callStore";

export function CallBridge({
	showConversation,
}: {
	/** Abre a janela da conversa (o `showDm` da `features/dms`). */
	showConversation: (channelId: string) => void;
}) {
	useVoiceFollowsCall(showConversation);
	useRingCard();
	useRingAnswers(showConversation);
	return null;
}

function useVoiceFollowsCall(showConversation: (channelId: string) => void) {
	const { voiceChannelId, voiceKind, connectionState, join, leave } =
		useVoice();
	const phase = useCallStore((state) => state.phase);
	const call = useCallStore((state) => state.call);
	const me = useCallStore((state) => state.me);
	const ended = useCallStore((state) => state.ended);
	const navigate = useNavigate();
	const { pathname } = useLocation();
	/** A ligação para a qual a voz já foi chamada. */
	const joined = useRef<string | null>(null);
	/** A ligação cuja sala a voz já alcançou: só depois disso sair dela é desligar. */
	const reached = useRef<string | null>(null);
	const live = phase === "connecting" || phase === "in_call";

	// Atendida: entra na sala da conversa. Depois disso, sair dela é desligar.
	useEffect(() => {
		if (!live || !call) return;
		if (joined.current !== call.id) {
			joined.current = call.id;
			if (voiceChannelId === call.channel_id) {
				reached.current = call.id;
			} else {
				setReturnRoom(voiceKind === "room" ? voiceChannelId : null);
				stopWatching();
				join(call.channel_id, {
					kind: "call",
					title: personName(otherPerson(call, me)),
				});
			}
			void navigate(paths.voiceRoom);
			return;
		}
		if (voiceChannelId === call.channel_id) {
			reached.current = call.id;
		} else if (reached.current === call.id) {
			reached.current = null;
			void hangUp().catch(() => {});
		}
	}, [live, call, me, voiceChannelId, voiceKind, join, navigate]);

	useEffect(() => {
		if (
			phase === "connecting" &&
			call &&
			voiceChannelId === call.channel_id &&
			connectionState === "connected"
		) {
			markConnected();
		}
	}, [phase, call, voiceChannelId, connectionState]);

	// Acabou (do outro lado, pelo tempo, ou aqui): a voz sai da sala da ligação, quem estava na
	// tela dela sai também, e a conversa abre, com o registro e o "Voltar para a sala".
	const shownEnd = useRef<string | null>(null);
	useEffect(() => {
		if (live) return;
		joined.current = null;
		reached.current = null;
		if (voiceKind === "call") {
			leave();
			stopWatching();
			if (pathname === paths.voiceRoom) {
				void navigate(paths.server, { replace: true });
			}
		}
		if (ended?.outcome === "answered" && shownEnd.current !== ended.id) {
			shownEnd.current = ended.id;
			showConversation(ended.channelId);
		}
	}, [live, voiceKind, leave, pathname, navigate, ended, showConversation]);
}

function useRingCard() {
	const call = useCallStore((state) =>
		state.phase === "ringing" ? state.call : null,
	);
	const status = useMyStatus();
	const { voiceKind, screenShare } = useVoice();
	const sharing = useScreenShareState(screenShare).status === "active";
	const inRoom = voiceKind === "room";
	// Em Ocupado, a ligação não toca: só o avatar na lateral e a faixa na conversa.
	const ringing = call && status !== "busy" ? call : null;

	useEffect(() => {
		if (!ringing) {
			void notificationRing(null).catch(() => {});
			return;
		}
		void notificationRing(ringCard(ringing, { inRoom, sharing })).catch(
			() => {},
		);
	}, [ringing, inRoom, sharing]);

	// O app saindo (ou a conta) não deixa o toque preso na outra janela.
	useEffect(() => () => void notificationRing(null).catch(() => {}), []);
}

function useRingAnswers(showConversation: (channelId: string) => void) {
	useEffect(() => {
		const stop = onNotificationAnswer((value) => {
			const answer = parseAnswer(value);
			const { call } = useCallStore.getState();
			if (!answer || !call || call.id !== answer.callId) return;
			switch (answer.action) {
				case "accept":
					void acceptRinging().catch(() => {});
					break;
				case "decline":
					void declineRinging().catch(() => {});
					break;
				case "reply":
					// Recusa e abre a conversa, com o foco no campo (o `Composer` faz isso ao abrir).
					showConversation(call.channel_id);
					void declineRinging().catch(() => {});
					break;
			}
		});
		return () => void stop.then((unlisten) => unlisten());
	}, [showConversation]);
}

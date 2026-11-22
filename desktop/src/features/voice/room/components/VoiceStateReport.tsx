/**
 * Conta para a API o próprio estado na sala do grupo (v0.7): microfone, áudio, câmera e tela. É o
 * que faz quem está fora da sala ver os ícones na lista de canais, porque o LiveKit não avisa a API
 * de quem muta, e o áudio desligado nem passa por ele. Ao sair, avisa também, e a API relê a sala
 * (sem o webhook do LiveKit, no `livekit-server --dev`, é o que tira a pessoa da lista).
 *
 * Só na sala do grupo: uma ligação privada não conta nada a ninguém.
 */
import { useEffect } from "react";
import {
	type ScreenShareController,
	useScreenShareState,
	useShareViewerList,
} from "@/features/screen-share";
import { leaveVoiceState, putVoiceState } from "@/lib/api";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";

export function VoiceStateReport({
	channelId,
	screenShare,
}: {
	channelId: string;
	/** A própria transmissão: a fonte, o preset e desde quando vão junto, para o cartão de Assistir. */
	screenShare: ScreenShareController | null;
}) {
	const me = useLiveMembers().find((member) => member.isLocal);
	const micOff = me?.micOff ?? false;
	const deafened = me?.deafened ?? false;
	const camera = me?.camera ?? false;
	const sharing = me?.sharing ?? false;
	const present = me !== undefined;
	const shareState = useScreenShareState(screenShare);
	const active = shareState.status === "active" ? shareState : null;
	const title = active?.source.title ?? null;
	const window = active?.source.source.kind === "window";
	const quality = active?.quality ?? null;
	const startedAt = active?.startedAt ?? null;
	const viewers = useShareViewerList((state) => state.viewers.length);

	useEffect(() => {
		if (!present) return;
		putVoiceState(channelId, {
			mic_off: micOff,
			deafened,
			camera,
			sharing,
			share:
				title !== null && quality !== null && startedAt !== null
					? {
							title,
							window,
							quality,
							started_at: startedAt,
							viewers,
						}
					: null,
		}).catch(() => {
			// Sem a API agora: a próxima mudança conta de novo.
		});
	}, [
		channelId,
		present,
		micOff,
		deafened,
		camera,
		sharing,
		title,
		window,
		quality,
		startedAt,
		viewers,
	]);

	useEffect(
		() => () => {
			leaveVoiceState(channelId).catch(() => {});
		},
		[channelId],
	);

	return null;
}

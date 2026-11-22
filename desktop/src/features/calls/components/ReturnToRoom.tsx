/**
 * "Voltar para a sala" (Etapa 22 da v0.3, quadro "Conversas — ligação encerrada"): ao fim da
 * ligação, quem estava numa sala quando ela começou vê esta faixa em cima do campo de mensagem,
 * "4 pessoas continuam na Sala", com Voltar e o X (ficar fora de sala). Ninguém volta sozinho.
 *
 * Só aparece na conversa da ligação que acabou, e some ao voltar, ao fechar ou ao começar outra.
 */
import { Volume2Icon, XIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	useMaybeVoice,
	useRoomName,
	useVoiceParticipants,
} from "@/features/voice";
import { paths } from "@/lib/paths";
import { dismissEnded, useCallStore } from "../stores/callStore";

export function ReturnToRoom({ channelId }: { channelId: string }) {
	const room = useCallStore((state) =>
		state.ended?.channelId === channelId ? state.returnRoom : null,
	);
	const me = useCallStore((state) => state.me);
	const voice = useMaybeVoice();
	const navigate = useNavigate();
	const { data: inRoom } = useVoiceParticipants(room ?? "", {
		enabled: room !== null,
	});
	const roomName = useRoomName(room);
	if (!room || !voice) return null;

	const others = (inRoom ?? []).filter((p) => p.user_id !== me).length;
	const label =
		others === 0
			? `A ${roomName} está vazia agora`
			: others === 1
				? `1 pessoa continua na ${roomName}`
				: `${others} pessoas continuam na ${roomName}`;

	return (
		<div
			role="status"
			className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-3 py-2 text-[13px] text-secondary-foreground"
		>
			<Volume2Icon aria-hidden="true" className="size-4 text-ring" />
			<span className="flex-1 truncate">{label}</span>
			<Button
				className="h-8"
				onClick={() => {
					dismissEnded();
					voice.join(room);
					void navigate(paths.voiceRoom);
				}}
			>
				Voltar
			</Button>
			<button
				type="button"
				aria-label="Ficar fora da sala"
				title="Ficar fora da sala"
				onClick={dismissEnded}
				className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
			>
				<XIcon aria-hidden="true" className="size-4" />
			</button>
		</div>
	);
}

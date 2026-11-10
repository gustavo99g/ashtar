import {
	HeadphoneOffIcon,
	HeadphonesIcon,
	MicIcon,
	MicOffIcon,
	PhoneOffIcon,
	ScreenShareIcon,
} from "lucide-react";
import type { ScreenShareController } from "@/features/screen-share";
import { useVoice } from "../../room/hooks/useVoice";
import { BarButton } from "./buttons";
import { ShareButton } from "./ShareButton";

/*
 * A barra de baixo da sala: Microfone, Áudio (o deafen), Tela e Sair. Sem o controller (ainda
 * conectando), o Tela fica desativado.
 */
export function CallControls({
	controller,
	onExit,
}: {
	controller: ScreenShareController | null;
	onExit: () => void;
}) {
	const { isMuted, isDeafened, mute, unmute, deafen, undeafen } = useVoice();

	return (
		<div className="flex h-[78px] shrink-0 items-center justify-center gap-2 border-t border-border bg-card">
			<BarButton
				label="Microfone"
				aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
				aria-pressed={isMuted}
				tone={isMuted ? "off" : "default"}
				onClick={() => void (isMuted ? unmute() : mute())}
			>
				{isMuted ? <MicOffIcon /> : <MicIcon />}
			</BarButton>
			<BarButton
				label="Áudio"
				aria-label={isDeafened ? "Ativar áudio" : "Desativar áudio"}
				aria-pressed={isDeafened}
				tone={isDeafened ? "off" : "default"}
				onClick={() => void (isDeafened ? undeafen() : deafen())}
			>
				{isDeafened ? <HeadphoneOffIcon /> : <HeadphonesIcon />}
			</BarButton>
			{controller ? (
				<ShareButton controller={controller} variant="bar" />
			) : (
				<BarButton label="Tela" disabled>
					<ScreenShareIcon />
				</BarButton>
			)}
			<span aria-hidden="true" className="mx-2 h-10 w-px bg-border" />
			<BarButton
				label="Sair"
				aria-label="Sair da sala"
				tone="exit"
				onClick={onExit}
			>
				<PhoneOffIcon className="size-[22px]!" />
			</BarButton>
		</div>
	);
}

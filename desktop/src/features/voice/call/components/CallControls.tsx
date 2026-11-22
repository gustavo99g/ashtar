import {
	HeadphoneOffIcon,
	HeadphonesIcon,
	MicIcon,
	MicOffIcon,
	PhoneOffIcon,
	ScreenShareIcon,
} from "lucide-react";
import type { ScreenShareController } from "@/features/screen-share";
import { CameraButton } from "../../camera/components/CameraButton";
import { ShieldBadge } from "../../members/components/MuteMark";
import { useVoice } from "../../room/hooks/useVoice";
import { BarButton } from "./buttons";
import { ShareButton } from "./ShareButton";

/*
 * A barra de baixo da sala: Microfone, Áudio (o deafen), Câmera, Tela e Sair. Sem o controller (ainda
 * conectando), o Tela fica desativado. Na ligação privada, o Sair é o Desligar.
 */
export function CallControls({
	controller,
	onExit,
	call = false,
}: {
	controller: ScreenShareController | null;
	onExit: () => void;
	/** Na ligação privada: o Sair vira Desligar. */
	call?: boolean;
}) {
	const {
		isMuted,
		isDeafened,
		serverMuted,
		serverDeafened,
		mute,
		unmute,
		deafen,
		undeafen,
	} = useVoice();

	return (
		<div className="flex h-[78px] shrink-0 items-center justify-center gap-2 border-t border-border bg-card">
			<BarButton
				label="Microfone"
				aria-label={
					serverMuted
						? "Silenciado pela moderação"
						: isMuted
							? "Ativar microfone"
							: "Desativar microfone"
				}
				title={serverMuted ? "Silenciado pela moderação" : undefined}
				aria-pressed={isMuted}
				tone={isMuted ? "off" : "default"}
				onClick={() => {
					if (serverMuted) return;
					void (isMuted ? unmute() : mute());
				}}
			>
				{isMuted ? <MicOffIcon /> : <MicIcon />}
				{serverMuted && <ShieldBadge />}
			</BarButton>
			<BarButton
				label="Áudio"
				aria-label={
					serverDeafened
						? "Áudio desligado pela moderação"
						: isDeafened
							? "Ativar áudio"
							: "Desativar áudio"
				}
				title={serverDeafened ? "Áudio desligado pela moderação" : undefined}
				aria-pressed={isDeafened}
				tone={isDeafened ? "off" : "default"}
				onClick={() => {
					if (serverDeafened) return;
					void (isDeafened ? undeafen() : deafen());
				}}
			>
				{isDeafened ? <HeadphoneOffIcon /> : <HeadphonesIcon />}
				{serverDeafened && <ShieldBadge />}
			</BarButton>
			<CameraButton />
			{controller ? (
				<ShareButton controller={controller} variant="bar" />
			) : (
				<BarButton label="Tela" disabled>
					<ScreenShareIcon />
				</BarButton>
			)}
			<span aria-hidden="true" className="mx-2 h-10 w-px bg-border" />
			<BarButton
				label={call ? "Desligar" : "Sair"}
				aria-label={call ? "Desligar a ligação" : "Sair da sala"}
				tone="exit"
				onClick={onExit}
			>
				<PhoneOffIcon className="size-[22px]!" />
			</BarButton>
		</div>
	);
}

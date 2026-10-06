import { Button } from "@/components/ui/button";
import { useVoice } from "@/features/voice/useVoice";

const VoiceControls = () => {
	const {

		isMuted,
		isDeafened,
		mute,
		unmute,
		leave,
		deafen,
		undeafen,
	} = useVoice();

	return (
		<footer className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-surface-alt px-4 py-3">
			<Button
				type="button"
				variant={isMuted ? "danger" : "secondary"}
				size="icon"
				aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
				onClick={() => {
					void (isMuted ? unmute() : mute());
				}}
			>
				{isMuted ? "🔇" : "🎙️"}
			</Button>

			<Button
				type="button"
				variant={isDeafened ? "danger" : "secondary"}
				size="icon"
				aria-label={isDeafened ? "Ativar áudio" : "Desativar áudio"}
				onClick={() => {
					void (isDeafened ? undeafen() : deafen());
				}}
			>
				{isDeafened ? "🔇" : "🎧"}
			</Button>

			<Button
				type="button"
				variant="outline"
				size="icon"
				aria-label="Sair do canal"
				onClick={() => {
					void leave();
				}}
			>
				📞
			</Button>
		</footer>
	);
};

export { VoiceControls };

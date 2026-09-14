import { Button } from "@/components/ui/button";
import useVoice from "@/hooks/useVoice";

const UserPanel = () => {
	const {
		voiceChannelId,
		isScreenSharing,
		isConnected,
		isMuted,
		isDeafened,
		mute,
		unmute,
		leave,
		deafen,
		undeafen,
		startScreenShare,
		stopScreenShare,
	} = useVoice();

	if (!voiceChannelId) {
		return null;
	}

	const channelName = voiceChannelId.replace("_voice", "");

	return (
		<section className="shrink-0 border-t border-line bg-surface-low px-2 py-2">
			<div className="flex items-center gap-2 px-2">
				<span
					className={[
						"size-2 shrink-0 rounded-full",
						isConnected ? "bg-online" : "bg-warning",
					].join(" ")}
				/>

				<div className="min-w-0 flex-1">
					<p className="truncate text-xs font-semibold text-primary">
						{channelName}
					</p>

					<p className="truncate text-xs text-muted">
						{isConnected ? "Voz conectada" : "Conectando..."}
					</p>
				</div>
			</div>

			<div className="mt-2 flex items-center justify-end gap-1">
				<Button
					type="button"
					variant={isMuted ? "danger" : "ghost"}
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
					variant={isDeafened ? "danger" : "ghost"}
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
					variant={isScreenSharing ? "danger" : "ghost"}
					size="icon"
					aria-label={
						isScreenSharing
							? "Parar compartilhamento de tela"
							: "Compartilhar tela"
					}
					onClick={() => {
						void (isScreenSharing ? stopScreenShare() : startScreenShare());
					}}
				>
					🖥️
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
			</div>
		</section>
	);
};

export { UserPanel };

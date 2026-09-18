import { Button } from "@/components/ui/button";
import useVoice from "@/hooks/useVoice";
import type { VoiceConnectionState } from "@/providers/voiceProvider";

function getConnectionLabel(state: VoiceConnectionState) {
	switch (state) {
		case "connecting":
			return "Conectando...";

		case "connected":
			return "Voz conectada";

		case "error":
			return "Falha na conexão";

		case "disconnected":
			return "Desconectado";
	}
}

function getConnectionColor(state: VoiceConnectionState) {
	switch (state) {
		case "connecting":
			return "bg-warning";

		case "connected":
			return "bg-online";

		case "error":
			return "bg-danger";

		case "disconnected":
			return "bg-offline";
	}
}

const UserPanel = () => {
	const {
		voiceChannelId,
		isScreenSharing,
		isMuted,
		isDeafened,
		isSomeoneScreenSharing,
		connectionState,
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
						getConnectionColor(connectionState),
					].join(" ")}
				/>

				<div className="min-w-0 flex-1">
					<p className="truncate text-xs font-semibold text-primary">
						{channelName}
					</p>

					<p className="truncate text-xs text-muted">
						{getConnectionLabel(connectionState)}
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
					disabled={!isScreenSharing && isSomeoneScreenSharing}
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

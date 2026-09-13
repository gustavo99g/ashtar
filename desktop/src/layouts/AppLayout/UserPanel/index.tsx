import { Button } from "@/components/ui/button";
import useVoice from "@/hooks/useVoice";

const UserPanel = () => {
	const { voiceChannelId, isConnected, isMuted, mute, unmute, leave } =
		useVoice();

	if (!voiceChannelId) {
		return null;
	}

	return (
		<section className="border-t border-line bg-surface-low px-2 py-2">
			<div className="mb-2 flex items-center gap-2 px-2">
				<span
					className={[
						"size-2 rounded-full",
						isConnected ? "bg-online" : "bg-danger",
					].join(" ")}
				/>

				<div className="min-w-0">
					<p className="truncate text-xs font-semibold text-primary">
						{voiceChannelId}
					</p>

					<p className="text-xs text-muted">
						{isConnected ? "Conectado" : "Conectando..."}
					</p>
				</div>
			</div>

			<div className="flex items-center justify-end gap-1">
				<Button
					type="button"
					variant={isMuted ? "danger" : "ghost"}
					size="icon"
					onClick={() => void (isMuted ? unmute() : mute())}
					aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
				>
					{isMuted ? "🔇" : "🎙️"}
				</Button>

				<Button
					type="button"
					variant="danger"
					size="icon"
					onClick={() => void leave()}
					aria-label="Sair do canal"
				>
					📞
				</Button>
			</div>
		</section>
	);
};

export { UserPanel };

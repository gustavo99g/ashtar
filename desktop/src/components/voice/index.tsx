import { useVoice } from "@/features/voice/useVoice";
import { VoiceControls } from "./controls";
import { VoiceMain } from "./main";

import { VoiceHeader } from "./voiceHeader";

// interface VoiceChannelProps {
// 	children?: ReactNode;
// 	channelId: string;
// }

const Voice = () => {
	const { room, connectionState } = useVoice();
	return (
		<section className="flex min-h-0 flex-1 flex-col bg-surface">
			<VoiceHeader />
			{connectionState === "reconnecting" && (
				<div className="shrink-0 bg-warning px-4 py-1 text-center text-xs font-semibold text-inverse">
					Conexão instável. Reconectando...
				</div>
			)}

			{/* Os componentes abaixo usam hooks do LiveKit, que exigem a sala no RoomContext. */}
			{room ? (
				<VoiceMain />
			) : (
				<div className="flex flex-1 items-center justify-center text-sm text-muted">
					{connectionState === "error"
						? "Não foi possível entrar no canal."
						: "Conectando..."}
				</div>
			)}

			<VoiceControls />
		</section>
	);
};

export { Voice };

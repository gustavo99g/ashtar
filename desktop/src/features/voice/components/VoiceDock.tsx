import { SourcePickerHost } from "@/features/screen-share";
import { SALA } from "../channel";
import { useVoice } from "../useVoice";
import { UserPanel } from "./UserPanel";
import { VoiceConnection } from "./VoiceConnection";

/**
 * O pé da coluna do servidor: o painel "Voz conectada" enquanto há chamada e o cartão de quem está
 * usando. O seletor de fonte mora aqui porque a coluna fica montada em todas as telas da chamada.
 */
export function VoiceDock() {
	const { voiceChannelId, screenShare } = useVoice();

	return (
		<div className="shrink-0 px-2 pb-2">
			<div className="flex flex-col rounded-xl border border-border bg-secondary">
				{voiceChannelId && <VoiceConnection />}
				<UserPanel />
			</div>
			{screenShare && (
				<SourcePickerHost controller={screenShare} channelName={SALA.name} />
			)}
		</div>
	);
}

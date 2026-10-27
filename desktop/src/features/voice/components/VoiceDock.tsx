import { SourcePickerHost } from "@/features/screen-share";
import { SALA } from "../channel";
import { useVoice } from "../useVoice";
import { ShareRaceGuard } from "./ShareRaceGuard";
import { UserPanel } from "./UserPanel";
import { VoiceConnection } from "./VoiceConnection";

/**
 * O pé da coluna do servidor: o painel "Voz conectada" enquanto há chamada e o cartão de quem está
 * usando. O seletor de fonte e a regra de uma transmissão por vez moram aqui porque a coluna fica
 * montada em todas as telas da chamada.
 */
export function VoiceDock() {
	const { voiceChannelId, room, screenShare } = useVoice();

	return (
		<div className="shrink-0 px-2 pb-2">
			<div className="flex flex-col rounded-xl border border-border bg-secondary">
				{voiceChannelId && <VoiceConnection />}
				<UserPanel />
			</div>
			{screenShare && (
				<SourcePickerHost controller={screenShare} channelName={SALA.name} />
			)}
			{room && screenShare && <ShareRaceGuard controller={screenShare} />}
		</div>
	);
}

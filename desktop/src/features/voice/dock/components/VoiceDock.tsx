import { SourcePickerHost } from "@/features/screen-share";
import { ShareNotices } from "../../call/components/ShareNotices";
import { ShareRaceGuard } from "../../room/components/ShareRaceGuard";
import { useVoice } from "../../room/hooks/useVoice";
import { SALA } from "../../room/model/channel";
import { ShareHost } from "./ShareHost";
import { TrayShare } from "./TrayShare";
import { UserPanel } from "./UserPanel";
import { VoiceConnection } from "./VoiceConnection";

/**
 * O pé da coluna do servidor: o painel "Voz conectada" enquanto há chamada e o cartão de quem está
 * usando. O seletor de fonte, o painel da transmissão, os avisos, a regra de uma transmissão por
 * vez e as opções da bandeja moram aqui porque a coluna fica montada em todas as telas da chamada.
 */
export function VoiceDock() {
	const { voiceChannelId, room, screenShare } = useVoice();

	return (
		<div className="shrink-0 px-2 pb-2">
			<div className="flex flex-col rounded-xl border border-border bg-secondary">
				{voiceChannelId && <VoiceConnection />}
				<UserPanel />
			</div>
			{screenShare &&
				(room ? (
					<ShareHost room={room} controller={screenShare} />
				) : (
					<SourcePickerHost
						controller={screenShare}
						channelName={SALA.name}
						ping={null}
					/>
				))}
			{screenShare && <ShareNotices controller={screenShare} />}
			{screenShare && <TrayShare controller={screenShare} />}
			{room && screenShare && <ShareRaceGuard controller={screenShare} />}
		</div>
	);
}

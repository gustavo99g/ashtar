import type { Room } from "livekit-client";
import { useEffect } from "react";
import {
	type ScreenShareController,
	SourcePickerHost,
	setShareViewers,
	useScreenShareState,
	useSharePanelOpen,
} from "@/features/screen-share";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import { useAnnounceShareQuality } from "../../room/hooks/useShareQuality";
import { useShareViewers } from "../../room/hooks/useShareViewers";
import { SALA } from "../../room/model/channel";
import { usePing } from "../hooks/usePing";

/**
 * O seletor e o painel da transmissão, com o que só a sala sabe: quem está assistindo, pelo nome e
 * desde quando (escrito no store que o popover e o painel leem), e o ping, medido só com o painel
 * aberto. Também avisa a sala da qualidade, para quem assiste ver a troca.
 */
export function ShareHost({
	room,
	controller,
}: {
	room: Room;
	controller: ScreenShareController;
}) {
	const state = useScreenShareState(controller);
	const active = state.status === "active";
	const viewers = useShareViewers(room, active);
	useAnnounceShareQuality(room, active ? state.quality : null, viewers);
	const members = useLiveMembers();
	const ping = usePing(useSharePanelOpen() ? room : null);

	useEffect(() => {
		setShareViewers(
			[...viewers].map(([id, since]) => ({
				id,
				since,
				name: members.find((member) => member.id === id)?.name ?? id,
			})),
		);
	}, [viewers, members]);
	useEffect(() => () => setShareViewers([]), []);

	return (
		<SourcePickerHost
			controller={controller}
			channelName={SALA.name}
			ping={ping}
		/>
	);
}

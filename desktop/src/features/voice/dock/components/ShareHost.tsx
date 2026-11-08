import type { Room } from "livekit-client";
import {
	type ScreenShareController,
	SourcePickerHost,
	useScreenShareState,
} from "@/features/screen-share";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import { useShareViewers } from "../../room/hooks/useShareViewers";
import { SALA } from "../../room/model/channel";

/** O seletor e o painel da transmissão, com quem está assistindo pelo nome (precisa da sala). */
export function ShareHost({
	room,
	controller,
}: {
	room: Room;
	controller: ScreenShareController;
}) {
	const active = useScreenShareState(controller).status === "active";
	const viewers = useShareViewers(room, active);
	const members = useLiveMembers();
	const names = [...viewers].map(
		(id) => members.find((member) => member.id === id)?.name ?? id,
	);
	return (
		<SourcePickerHost
			controller={controller}
			channelName={SALA.name}
			viewers={names}
		/>
	);
}

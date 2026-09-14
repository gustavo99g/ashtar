import useVoice from "@/hooks/useVoice";
import { Participants } from "../participants";
import { ScreenShareView } from "../screenShareView";

const VoiceMain = () => {
	const { participants } = useVoice();

	const screenSharers = participants.filter((participant) => {
		return participant.isScreenShareEnabled;
	});

	if (screenSharers.length === 0) {
		return (
			<div className="min-h-0 flex-1 p-4">
				<Participants />
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
			<div className="min-h-0 flex-1">
				<ScreenShareView participant={screenSharers[0]} />
			</div>

			<div className="h-28 shrink-0">
				<Participants compact />
			</div>
		</div>
	);
};

export { VoiceMain };

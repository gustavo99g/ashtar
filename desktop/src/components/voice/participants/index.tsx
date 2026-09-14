import { type Participant, Track } from "livekit-client";
import useVoice from "@/hooks/useVoice";

function getGridClass(count: number) {
	if (count <= 1) {
		return "grid-cols-1 grid-rows-1";
	}

	if (count === 2) {
		return "grid-cols-2 grid-rows-1";
	}

	if (count <= 4) {
		return "grid-cols-2 grid-rows-2";
	}

	if (count <= 6) {
		return "grid-cols-3 grid-rows-2";
	}

	if (count <= 9) {
		return "grid-cols-3 grid-rows-3";
	}

	return "grid-cols-4";
}
interface ParticipantsProps {
	compact?: boolean;
}

const Participants = ({ compact = false }: ParticipantsProps) => {
	const { participants } = useVoice();
	return (
		<div
			className={[
				"grid h-full min-h-0 gap-4",
				compact
					? "grid-cols-[repeat(auto-fit,minmax(120px,160px))]"
					: getGridClass(participants.length),
			].join(" ")}
		>
			{participants.map((participant) => (
				<ParticipantCard
					key={participant.identity}
					participant={participant}
					compact={compact}
				/>
			))}
		</div>
	);
};

interface ParticipantCardProps {
	participant: Participant;
	compact?: boolean;
}

function ParticipantCard({ participant, compact }: ParticipantCardProps) {
	const name = participant.name || participant.identity;
	const isMuted = !participant.isMicrophoneEnabled;

	const screenShare = participant.getTrackPublication(Track.Source.ScreenShare);

	const isScreenSharing = screenShare?.isSubscribed && screenShare.videoTrack;

	return (
		<div
			className={[
				"relative flex min-w-0",
				"items-center justify-center p-2",
				"overflow-hidden rounded-lg",
				"bg-surface-alt",
				"transition-colors",
				compact ? "min-h-12" : "min-h-0",
				participant.isSpeaking ? "ring-2 ring-online" : "",
			].join(" ")}
		>
			<div className="flex flex-col items-center gap-3">
				<div
					className={[
						"flex size-28 items-center justify-center rounded-full",
						"bg-accent text-3xl font-semibold text-inverse",
						"transition-all",
						compact ? "size-16 text-xl" : "size-28 text-3xl",
						participant.isSpeaking ? "ring-4 ring-online/30" : "",
					].join(" ")}
				>
					{name?.charAt(0).toUpperCase()}
				</div>

				<div className="flex items-center gap-2">
					<span
						className={[
							"max-w-48 truncate text-sm font-semibold text-primary",
							compact ? "text-xs" : "text-sm",
						].join(" ")}
					>
						{participant.name}
					</span>

					{isMuted && <span className="text-danger">🔇</span>}

					{isScreenSharing && <span className="text-xs text-online">🖥️</span>}
				</div>
			</div>
		</div>
	);
}

export { Participants };

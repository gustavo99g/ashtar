import type { Participant } from "livekit-client";
import useVoice from "@/hooks/useVoice";

function getGridClass(count: number) {
	if (count === 1) {
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

const Participants = () => {
	const { participants } = useVoice();
	const gridClass = getGridClass(participants.length);
	return (
		<div className={["grid min-h-0 flex-1 gap-4 p-6", gridClass].join(" ")}>
			{participants.map((participant) => (
				<ParticipantCard key={participant.identity} participant={participant} />
			))}
		</div>
	);
};

interface ParticipantCardProps {
	participant: Participant;
}

function ParticipantCard({ participant }: ParticipantCardProps) {
	console.log(participant.name, participant.isSpeaking);

	return (
		<div
			className="
        relative flex min-h-0 min-w-0
        items-center justify-center
        p-2
        overflow-hidden rounded-lg
        bg-surface-alt
      "
		>
			<div className="flex flex-col items-center gap-3">
				<div
					className={[
						"flex size-28 items-center justify-center rounded-full",
						"bg-accent text-3xl font-semibold text-inverse",
						participant.isSpeaking ? "ring-4 ring-red-400" : "",
					].join(" ")}
				>
					{participant.name?.charAt(0)}
				</div>

				<div className="flex items-center gap-2">
					<span className="max-w-48 truncate text-sm font-semibold text-primary">
						{participant.name}
					</span>

					{!participant.isMicrophoneEnabled && (
						<span className="text-danger">🔇</span>
					)}
				</div>
			</div>
		</div>
	);
}

export { Participants };

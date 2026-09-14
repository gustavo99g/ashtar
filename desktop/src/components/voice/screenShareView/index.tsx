import { VideoTrack } from "@livekit/components-react";
import { type Participant, Track } from "livekit-client";

interface ScreenShareViewProps {
	participant: Participant;
}

const ScreenShareView = ({ participant }: ScreenShareViewProps) => {
	const publication = participant.getTrackPublication(Track.Source.ScreenShare);

	if (!publication?.isSubscribed || !publication.videoTrack) {
		return null;
	}

	const trackRef = {
		participant,
		publication,
		source: Track.Source.ScreenShare,
	};

	return (
		<div className="h-full min-h-0 w-full overflow-hidden rounded-lg bg-black relative">
			<VideoTrack trackRef={trackRef} className="size-full object-contain" />

			<div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1">
				<span className="text-xs font-medium text-white">
					{participant.name || participant.identity}
				</span>
			</div>
		</div>
	);
};

export { ScreenShareView };

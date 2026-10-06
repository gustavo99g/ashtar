import { type TrackReference, VideoTrack } from "@livekit/components-react";

interface ScreenShareViewProps {
	trackRef: TrackReference;
}

const ScreenShareView = ({ trackRef }: ScreenShareViewProps) => {
  const { participant, publication } = trackRef;

	if (!publication.isSubscribed || !publication.videoTrack) {
		return null;
	}

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

import { type TrackReference, VideoTrack } from "@livekit/components-react";
import { type Participant, Track } from "livekit-client";
import { cn } from "@/lib/utils";

/**
 * A câmera de `participant`, quando ela está ligada e chegando: a própria, publicada; a dos outros,
 * assinada (só com os blocos à vista, `subscriptions.ts`). Senão, `null`, e o bloco mostra o avatar.
 */
export function cameraTrackOf(
	participant: Participant | undefined,
): TrackReference | null {
	if (!participant) return null;
	const publication = participant.getTrackPublication(Track.Source.Camera);
	if (!publication?.track || publication.isMuted) return null;
	if (!participant.isLocal && !publication.isSubscribed) return null;
	return { participant, publication, source: Track.Source.Camera };
}

/** O vídeo da câmera, cobrindo o bloco. `mirror` só na própria, se a pessoa escolheu. */
export function CameraVideo({
	trackRef,
	mirror = false,
	className,
}: {
	trackRef: TrackReference;
	mirror?: boolean;
	className?: string;
}) {
	return (
		<VideoTrack
			trackRef={trackRef}
			className={cn(
				"pointer-events-none size-full object-cover",
				mirror && "-scale-x-100",
				className,
			)}
		/>
	);
}

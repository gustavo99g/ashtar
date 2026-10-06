import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Button } from "@/components/ui/button";
import { useScreenShareState } from "@/features/screen-share/useScreenShareState";
import { useVoice } from "@/features/voice/useVoice";
import { Participants } from "../participants";
import { ScreenShareView } from "../screenShareView";

const VoiceMain = () => {
	const { screenShare } = useVoice();
	const shareState = useScreenShareState(screenShare);

	const remoteShare = useTracks([Track.Source.ScreenShare]).find(
		(trackRef) => !trackRef.participant.isLocal,
	);

	const isLocalSharing = shareState.status === "active";
	const hasScreenShare = isLocalSharing || Boolean(remoteShare);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
			{/* Área principal */}
			<div className="min-h-0 flex-1">
				{isLocalSharing ? (
					<div className="flex h-full items-center justify-center rounded-lg bg-surface-alt">
						<div className="flex max-w-sm flex-col items-center text-center">
							<div className="mb-4 flex size-16 items-center justify-center rounded-full bg-raised text-2xl">
								🖥️
							</div>

							<h2 className="text-base font-semibold text-primary">
								Você está compartilhando sua tela
							</h2>

							<p className="mt-1 text-sm text-muted">
								{shareState.audio === "lost"
									? "O áudio parou. O vídeo continua sendo transmitido."
									: "Os outros participantes podem ver sua tela."}
							</p>

							<Button
								type="button"
								variant="danger"
								className="mt-4"
								onClick={() => void screenShare?.stop()}
							>
								Parar compartilhamento
							</Button>
						</div>
					</div>
				) : remoteShare  ? (
					<ScreenShareView trackRef={remoteShare}  />
				) : (
					<Participants />
				)}
			</div>

			{/* Participantes */}
			{hasScreenShare && (
				<div className="h-28 shrink-0">
					<Participants compact />
				</div>
			)}
		</div>
	);
};

export { VoiceMain };

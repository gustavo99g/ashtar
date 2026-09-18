import { Button } from "@/components/ui/button";
import useVoice from "@/hooks/useVoice";
import { Participants } from "../participants";
import { ScreenShareView } from "../screenShareView";

const VoiceMain = () => {
	const { participants, room, stopScreenShare } = useVoice();

	const localParticipant = room?.localParticipant;

	const isLocalScreenSharing = localParticipant?.isScreenShareEnabled ?? false;

	const screenSharer = participants.find((participant) => {
		return (
			participant.isScreenShareEnabled &&
			participant.identity !== localParticipant?.identity
		);
	});

	const hasScreenShare = isLocalScreenSharing || Boolean(screenSharer);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
			{/* Área principal */}
			<div className="min-h-0 flex-1">
				{isLocalScreenSharing ? (
					<div className="flex h-full items-center justify-center rounded-lg bg-surface-alt">
						<div className="flex max-w-sm flex-col items-center text-center">
							<div className="mb-4 flex size-16 items-center justify-center rounded-full bg-raised text-2xl">
								🖥️
							</div>

							<h2 className="text-base font-semibold text-primary">
								Você está compartilhando sua tela
							</h2>

							<p className="mt-1 text-sm text-muted">
								Os outros participantes podem ver sua tela.
							</p>

							<Button
								type="button"
								variant="danger"
								className="mt-4"
								onClick={() => void stopScreenShare()}
							>
								Parar compartilhamento
							</Button>
						</div>
					</div>
				) : screenSharer ? (
					<ScreenShareView participant={screenSharer} />
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

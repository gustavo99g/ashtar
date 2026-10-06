import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ScreenShareController } from "@/features/screen-share/controller";
import { SourcePicker } from "@/features/screen-share/SourcePicker";
import { useScreenShareState } from "@/features/screen-share/useScreenShareState";

interface ScreenShareButtonProps {
	controller: ScreenShareController;
	channelName: string;
}

/** Botão de compartilhar/parar. Usa hooks do LiveKit: só renderizar com a sala conectada. */
const ScreenShareButton = ({
	controller,
	channelName,
}: ScreenShareButtonProps) => {
	const state = useScreenShareState(controller);
	const [isPickerOpen, setIsPickerOpen] = useState(false);

	const someoneElseSharing = useTracks([Track.Source.ScreenShare]).some(
		(trackRef) => !trackRef.participant.isLocal,
	);

	const isActive = state.status === "active";
	const isStarting = state.status === "starting";

	return (
		<>
			<Button
				type="button"
				variant={isActive ? "danger" : "ghost"}
				disabled={isStarting || (!isActive && someoneElseSharing)}
				size="icon"
				aria-label={
					isActive ? "Parar compartilhamento de tela" : "Compartilhar tela"
				}
				onClick={() => {
					if (isActive) {
						void controller.stop();
						return;
					}
					setIsPickerOpen(true);
				}}
			>
				🖥️
			</Button>

			{isPickerOpen && (
				<SourcePicker
					controller={controller}
					channelName={channelName}
					onClose={() => setIsPickerOpen(false)}
				/>
			)}
		</>
	);
};

export { ScreenShareButton };

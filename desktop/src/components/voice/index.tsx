import type { ReactNode } from "react";
import { VoiceControls } from "./controls";
import { Participants } from "./participants";
import { VoiceHeader } from "./voiceHeader";

interface VoiceChannelProps {
	children?: ReactNode;
}

const Voice = ({ children }: VoiceChannelProps) => {
	return (
		<section className="flex min-h-0 flex-1 flex-col bg-surface">
			<VoiceHeader />

			<Participants />
			{children}

			<VoiceControls />
		</section>
	);
};

export { Voice };

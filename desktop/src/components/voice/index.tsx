import { VoiceControls } from "./controls";
import { VoiceMain } from "./main";

import { VoiceHeader } from "./voiceHeader";

// interface VoiceChannelProps {
// 	children?: ReactNode;
// 	channelId: string;
// }

const Voice = () => {
	return (
		<section className="flex min-h-0 flex-1 flex-col bg-surface">
			<VoiceHeader />

			<VoiceMain />

			<VoiceControls />
		</section>
	);
};

export { Voice };

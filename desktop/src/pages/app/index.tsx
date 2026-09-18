import { AudioTest } from "@/components/audioTemp";
import { AppLayout } from "@/layouts/AppLayout";
import VoiceProvider from "@/providers/voiceProvider";

const AppPage = () => {
	return (
		<VoiceProvider>
			<AudioTest />
			<AppLayout />
		</VoiceProvider>
	);
};

export { AppPage };

import { AppLayout } from "@/layouts/AppLayout";
import VoiceProvider from "@/providers/voiceProvider";

const AppPage = () => {
	return (
		<VoiceProvider>
			<AppLayout />
		</VoiceProvider>
	);
};

export { AppPage };

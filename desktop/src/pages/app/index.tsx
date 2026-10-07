import { VoiceProvider } from "@/features/voice/VoiceProvider";
import { AppLayout } from "@/layouts/AppLayout";

const AppPage = () => {
	return (
		<VoiceProvider>
			<AppLayout />
		</VoiceProvider>
	);
};

export { AppPage };

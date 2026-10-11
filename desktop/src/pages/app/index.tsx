import { UpdateNotice } from "@/features/updater/UpdateNotice";
import { VoiceProvider } from "@/features/voice/VoiceProvider";
import { AppLayout } from "@/layouts/AppLayout";

const AppPage = () => {
	return (
		<VoiceProvider>
			<AppLayout />
			<UpdateNotice />
		</VoiceProvider>
	);
};

export { AppPage };

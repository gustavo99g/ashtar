import { UpdateNotice } from "@/features/updater/UpdateNotice";
import { WhatsNewDialog } from "@/features/updater/WhatsNewDialog";
import { VoiceProvider } from "@/features/voice/VoiceProvider";
import { AppLayout } from "@/layouts/AppLayout";

const AppPage = () => {
	return (
		<VoiceProvider>
			<AppLayout />
			<UpdateNotice />
			<WhatsNewDialog />
		</VoiceProvider>
	);
};

export { AppPage };

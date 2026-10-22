/**
 * Raiz do app: os provedores que valem para todas as telas e, dentro deles, o router.
 *
 * O `VoiceProvider` fica acima do router para a chamada sobreviver à troca de rota.
 */
import "@/styles/App.css";
import { RouterProvider } from "react-router-dom";
import { useApplyTheme } from "@/features/settings";
import { UpdateNotice, WhatsNewDialog } from "@/features/updater";
import { VoiceProvider } from "@/features/voice";
import { router } from "./router";

export function App() {
	useApplyTheme();
	return (
		<VoiceProvider>
			<RouterProvider router={router} />
			<UpdateNotice />
			<WhatsNewDialog />
		</VoiceProvider>
	);
}

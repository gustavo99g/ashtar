/**
 * Raiz do app: os provedores que valem para todas as telas e, dentro deles, o router.
 *
 * O `VoiceProvider` fica acima do router para a chamada sobreviver à troca de rota. O cache da
 * API (`QueryClientProvider`) fica acima de tudo. O `SessionWatcher` precisa dos dois: quando
 * este computador sai do grupo, ele derruba a chamada, limpa o cache e chama `goToLeftGroup`.
 */
import "@/styles/App.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionWatcher } from "@/features/identity";
import { useApplyTheme } from "@/features/settings";
import { UpdateNotice, WhatsNewDialog } from "@/features/updater";
import { VoiceProvider } from "@/features/voice";
import { paths } from "@/lib/paths";
import { queryClient } from "@/lib/query";
import { router } from "./router";

function goToLeftGroup() {
	void router.navigate(paths.entry.leftGroup, { replace: true });
}

export function App() {
	useApplyTheme();
	return (
		<QueryClientProvider client={queryClient}>
			<VoiceProvider>
				<SessionWatcher onLeftGroup={goToLeftGroup} />
				<TooltipProvider>
					<Toaster>
						<RouterProvider router={router} />
						<UpdateNotice />
						<WhatsNewDialog />
					</Toaster>
				</TooltipProvider>
			</VoiceProvider>
		</QueryClientProvider>
	);
}

/**
 * Raiz do app: os provedores que valem para todas as telas e, dentro deles, o router.
 *
 * O `VoiceProvider` fica acima do router para a chamada sobreviver à troca de rota. O cache da
 * API (`QueryClientProvider`) fica acima de tudo. Quando este computador sai do grupo, o
 * `SessionWatcher` limpa o cache e chama `goToLeftGroup`, que também esquece as mensagens que
 * estavam saindo, e o `VoiceProvider`, que acompanha a sessão, derruba a chamada. O `RealtimeBridge` liga o WebSocket da API enquanto a sessão está
 * conectada.
 */
import "@/styles/App.css";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clearOutbox } from "@/features/chat";
import { SessionWatcher } from "@/features/identity";
import { useApplyTheme } from "@/features/settings";
import { UpdateNotice, WhatsNewDialog } from "@/features/updater";
import { useVoice, VoiceProvider } from "@/features/voice";
import { paths } from "@/lib/paths";
import { queryClient } from "@/lib/query";
import { RealtimeBridge } from "./RealtimeBridge";
import { router } from "./router";

function goToLeftGroup() {
	clearOutbox();
	void router.navigate(paths.entry.leftGroup, { replace: true });
}

/** Numa chamada, os avisos do canto sobem para acima da barra da sala. */
function AppToaster({ children }: { children: ReactNode }) {
	const { connectionState } = useVoice();
	const inCall =
		connectionState !== "disconnected" && connectionState !== "error";
	return <Toaster raised={inCall}>{children}</Toaster>;
}

export function App() {
	useApplyTheme();
	return (
		<QueryClientProvider client={queryClient}>
			<VoiceProvider>
				<SessionWatcher onLeftGroup={goToLeftGroup} />
				<RealtimeBridge />
				<TooltipProvider>
					<AppToaster>
						<RouterProvider router={router} />
						<UpdateNotice />
						<WhatsNewDialog />
					</AppToaster>
				</TooltipProvider>
			</VoiceProvider>
		</QueryClientProvider>
	);
}

/**
 * Raiz da janela dos avisos (`notifications.html`, criada pelo `notifications.rs`): só a pilha de
 * cartões, com o tema do app. Não tem router, sessão nem tempo real; quem decide o que aparece é a
 * janela principal, que manda cada cartão pelo Rust.
 */
import "@/styles/App.css";
import { NotificationStack } from "@/features/notifications/window";
import { useApplyTheme } from "@/features/settings";

export function NotificationsApp() {
	useApplyTheme();
	return <NotificationStack />;
}

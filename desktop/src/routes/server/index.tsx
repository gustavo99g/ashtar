import { Navigate } from "react-router-dom";
import { useLastChannel } from "@/features/channels";
import { paths } from "@/lib/paths";

/**
 * A tela do servidor é o último canal de texto aberto neste computador (o `#geral` na primeira
 * vez). Quem navega para cá (a abertura, o ESC das configurações, sair da sala) cai nele.
 */
export function ServerRoute() {
	const channelId = useLastChannel((state) => state.channelId);
	return <Navigate to={paths.channel(channelId)} replace />;
}

import { useParams } from "react-router-dom";
import { ChatView } from "@/features/chat";

/** Um canal de texto: a conversa e a coluna de membros. */
export function ChannelRoute() {
	const { channelId = "" } = useParams();
	// A `key` recomeça a tela ao trocar de canal: a rolagem e o campo não passam de um para o outro.
	return <ChatView key={channelId} channelId={channelId} />;
}

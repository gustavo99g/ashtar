import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./input";
import { Messages } from "./messages";

interface ChatProps {
	channelId: string;
}

const Chat = ({ channelId }: ChatProps) => {
	function handleSend(message: string) {
		console.log("Mensagem:", message);
	}

	return (
		<section className="flex min-h-0 flex-1 flex-col bg-surface">
			<ChatHeader />
			<Messages />
			<ChatInput onSend={handleSend} />
		</section>
	);
};

export { Chat };

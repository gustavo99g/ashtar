import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
	onSend: (message: string) => void;
}

const ChatInput = ({ onSend }: ChatInputProps) => {
	const [message, setMessage] = useState("");

	const hasMessage = message.trim().length > 0;

	const handleSend = () => {
		const content = message.trim();
		if (!content) {
			return;
		}

		onSend(content);
		setMessage("");
	};

	function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	return (
		<div className="shrink-0 px-4 pb-4">
			<div className="flex items-end gap-2 rounded-lg bg-input px-3 py-2">
				<Button variant="ghost" size="icon" aria-label="Adicionar arquivo">
					+
				</Button>

				<textarea
					placeholder="Enviar mensagem em #general"
					rows={1}
					className="
            min-h-8 flex-1 resize-none bg-transparent py-1
            text-sm text-primary outline-none
            placeholder:text-muted
          "
					value={message}
					onChange={(event) => setMessage(event.target.value)}
					onKeyDown={handleKeyDown}
				/>

				<Button variant="ghost" size="icon" aria-label="Adicionar emoji">
					😀
				</Button>

				<Button
					variant="ghost"
					size="icon"
					aria-label="Enviar mensagem"
					disabled={!hasMessage}
					onClick={handleSend}
				>
					➤
				</Button>
			</div>
		</div>
	);
};

export { ChatInput };

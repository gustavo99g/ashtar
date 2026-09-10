import { Button } from "@/components/ui/button";
import { ChatDivider } from "../divider";
import { EmptyChat } from "../emptyChat";

const messages = [
	{
		id: "1",
		author: "Gustavo",
		avatar: "G",
		timestamp: "Hoje às 22:31",
		content: "Olá pessoal!",
		grouped: false,
	},
	{
		id: "2",
		author: "Gustavo",
		avatar: "G",
		timestamp: "Hoje às 22:31",
		content: "Alguém vai jogar hoje?",
		grouped: true,
	},
	{
		id: "3",
		author: "João",
		avatar: "J",
		timestamp: "Hoje às 22:32",
		content: "Sim, vou entrar mais tarde.",
		grouped: false,
	},
	{
		id: "4",
		author: "Maria",
		avatar: "M",
		timestamp: "Hoje às 22:33",
		content: "Eu também!",
		grouped: false,
	},
	{
		id: "5",
		author: "Maria",
		avatar: "M",
		timestamp: "Hoje às 22:33",
		content: "Só preciso terminar uma coisa aqui.",
		grouped: true,
	},
];

const Messages = () => {
	if (messages.length === 0) {
		return <EmptyChat />;
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
			<div className="flex flex-col gap-2">
				<ChatDivider label="Hoje" />
				{messages.map((message) => (
					<MessageItem key={message.id} {...message} />
				))}
			</div>
		</div>
	);
};

interface MessageItemProps {
	author: string;
	avatar: string;
	timestamp: string;
	content: string;
	grouped?: boolean;
}

export function MessageItem({
	author,
	avatar,
	timestamp,
	content,
	grouped = false,
}: MessageItemProps) {
	if (grouped) {
		return (
			<article className="group relative flex gap-1 px-6 py-2 hover:bg-hover/40 cursor-pointer">
				<div className="w-10 shrink-0" />
				<div className="min-w-0 flex-1">
					<p className="whitespace-pre-wrap break-words text-sm text-secondary">
						{content}
					</p>
				</div>

				<MessageActions />
			</article>
		);
	}

	return (
		<article className="group relative flex gap-3 px-4 py-2 hover:bg-hover/40 cursor-pointer">
			<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-inverse">
				{avatar}
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<span className="text-sm font-semibold text-primary">{author}</span>

					<span className="text-xs text-faint">{timestamp}</span>
				</div>

				<p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-secondary">
					{content}
				</p>
			</div>

			<MessageActions />
		</article>
	);
}

const MessageActions = () => {
	return (
		<div
			className="
           absolute right-4 top-0 hidden -translate-y-1/2
           items-center rounded-md border border-line bg-raised
           shadow-sm group-hover:flex
         "
		>
			<Button variant="ghost" size="icon" aria-label="Adicionar reação">
				😀
			</Button>

			<Button variant="ghost" size="icon" aria-label="Responder">
				↩
			</Button>

			<Button variant="ghost" size="icon" aria-label="Mais opções">
				⋯
			</Button>
		</div>
	);
};

export { Messages };

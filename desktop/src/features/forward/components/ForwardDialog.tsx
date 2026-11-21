/**
 * Encaminhar (decisão 29 do plano da v0.7): a janela que abre pelo menu da mensagem, com a busca
 * dos canais de texto e das conversas privadas e um comentário opcional, que vai logo depois como
 * mensagem comum. A encaminhada leva o texto e os anexos da original, com "Encaminhada" em cima.
 *
 * Fica fora do chat porque precisa da lista de conversas (`features/dms`), que importa o chat.
 */
import { HashIcon, SearchIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { textChannels, useChannelLayout } from "@/features/channels";
import {
	closeForward,
	useForwardRequest,
	useSendMessage,
} from "@/features/chat";
import { showDm, useDms } from "@/features/dms";
import { useNavigate } from "react-router-dom";
import { paths } from "@/lib/paths";
import { Avatar } from "@/features/identity";
import { cn } from "@/lib/utils";

interface Destination {
	id: string;
	label: string;
	kind: "channel" | "dm";
	nick?: string;
	displayName?: string | null;
}

/** Sem acento e em minúsculas, para a busca. */
function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

function useDestinations(): Destination[] {
	const layout = useChannelLayout().data;
	const dms = useDms().data ?? [];
	const channels: Destination[] = layout
		? textChannels(layout).map((channel) => ({
				id: channel.id,
				label: channel.name,
				kind: "channel",
			}))
		: [];
	const people: Destination[] = dms
		.filter((conversation) => !conversation.person.removed)
		.map((conversation) => ({
			id: conversation.id,
			label: conversation.person.display_name || conversation.person.nick,
			kind: "dm",
			nick: conversation.person.nick,
			displayName: conversation.person.display_name,
		}));
	return [...channels, ...people];
}

export function ForwardDialog() {
	const message = useForwardRequest((state) => state.message);
	return (
		<Dialog
			open={message !== null}
			onOpenChange={(open) => {
				if (!open) closeForward();
			}}
		>
			<DialogContent className="sm:max-w-[480px]">
				{message && <ForwardForm key={message.id} />}
			</DialogContent>
		</Dialog>
	);
}

function ForwardForm() {
	const message = useForwardRequest((state) => state.message);
	const destinations = useDestinations();
	const { send, forward } = useSendMessage();
	const [query, setQuery] = useState("");
	const [chosen, setChosen] = useState<string | null>(null);
	const [comment, setComment] = useState("");
	const listId = useId();
	const navigate = useNavigate();
	if (!message) return null;

	const shown = destinations.filter((d) => fold(d.label).includes(fold(query)));
	const target = destinations.find((d) => d.id === chosen) ?? null;

	function submit() {
		if (!message || !target) return;
		forward(target.id, message);
		if (comment.trim()) send(target.id, comment);
		closeForward();
		toast.add({
			title:
				target.kind === "channel"
					? `Encaminhada para #${target.label}`
					: `Encaminhada para ${target.label}`,
			actionProps: {
				children: "Abrir",
				onClick: () =>
					target.kind === "channel"
						? navigate(paths.channel(target.id))
						: showDm(target.id),
			},
		});
	}

	return (
		<>
			<DialogTitle>Encaminhar mensagem</DialogTitle>
			<DialogDescription>
				Vai o texto e os anexos, com "Encaminhada" em cima.
			</DialogDescription>
			<div className="relative">
				<SearchIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					autoFocus
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Buscar canal ou conversa"
					aria-label="Buscar canal ou conversa"
					aria-controls={listId}
					className="pl-9"
				/>
			</div>
			<div
				id={listId}
				role="radiogroup"
				aria-label="Para onde"
				className="-mx-1 flex max-h-[260px] flex-col overflow-y-auto"
			>
				{shown.length === 0 && (
					<p className="px-2 py-6 text-center text-sm text-muted-foreground">
						Nada com esse nome.
					</p>
				)}
				{shown.map((destination) => (
					<button
						key={destination.id}
						type="button"
						role="radio"
						aria-checked={destination.id === chosen}
						onClick={() => setChosen(destination.id)}
						className={cn(
							"flex h-10 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-secondary-foreground hover:bg-secondary hover:text-foreground",
							destination.id === chosen && "bg-selected text-foreground",
						)}
					>
						{destination.kind === "channel" ? (
							<HashIcon aria-hidden="true" className="size-5 text-muted-foreground" />
						) : (
							<Avatar
								nick={destination.nick ?? destination.label}
								displayName={destination.displayName}
								size={22}
							/>
						)}
						<span className="truncate">{destination.label}</span>
					</button>
				))}
			</div>
			<textarea
				value={comment}
				onChange={(event) => setComment(event.target.value)}
				rows={2}
				maxLength={2000}
				aria-label="Comentário (opcional)"
				placeholder="Comentário (opcional)"
				className="resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
			/>
			<DialogFooter>
				<DialogClose render={<Button variant="ghost" />}>Cancelar</DialogClose>
				<Button disabled={!target} onClick={submit}>
					Encaminhar
				</Button>
			</DialogFooter>
		</>
	);
}

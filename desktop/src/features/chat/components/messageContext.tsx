/**
 * O que a mensagem precisa para as ações dela (ADR 0032): quem lê, se pode excluir a dos outros, a
 * edição aberta, e o que fazer ao responder, reagir, excluir ou clicar numa citação. Quem dá é a
 * `ChatConversation`; sem ela (a lista sozinha, nos testes), a mensagem fica sem ações.
 */
import { createContext, useContext } from "react";
import type { Message } from "@/lib/api";
import type { Mentionable } from "../model/mentions";

export interface MessageActionsValue {
	myId: string | null;
	/** O dono num canal de texto: exclui a mensagem de qualquer um. */
	canModerate: boolean;
	people: ReadonlyMap<string, Mentionable>;
	/** A mensagem com o campo de edição aberto. */
	editingId: string | null;
	/** A mensagem que pisca depois de um "ir até" (a citação, a busca). */
	highlightId: string | null;
	startEdit: (message: Message) => void;
	stopEdit: () => void;
	saveEdit: (message: Message, body: string) => Promise<void>;
	reply: (message: Message) => void;
	/** `skipConfirm`: o Shift segurado no clique, como no Discord. */
	remove: (message: Message, skipConfirm: boolean) => void;
	react: (message: Message, emoji: string, on: boolean) => void;
	jumpTo: (messageId: string) => void;
}

export const MessageActionsContext = createContext<MessageActionsValue | null>(
	null,
);

export function useMessageActionsContext(): MessageActionsValue | null {
	return useContext(MessageActionsContext);
}

/** Se `myId` pode editar `message`: só o autor, e só o texto. */
export function canEdit(message: Message, myId: string | null): boolean {
	return message.kind === "text" && message.author.id === myId;
}

/** Se pode excluir: o autor, ou o dono numa mensagem de canal. O registro de ligação, ninguém. */
export function canDelete(
	message: Message,
	myId: string | null,
	canModerate: boolean,
): boolean {
	return (
		message.kind === "text" && (message.author.id === myId || canModerate)
	);
}

/** As reações rápidas da barra da mensagem e do menu (o canvas "Chat — menu da mensagem"). */
export const QUICK_REACTIONS: readonly { emoji: string; label: string }[] = [
	{ emoji: "👍", label: "polegar" },
	{ emoji: "❤️", label: "coração" },
	{ emoji: "😂", label: "risada" },
	{ emoji: "😮", label: "surpresa" },
	{ emoji: "😢", label: "choro" },
	{ emoji: "🔥", label: "fogo" },
];

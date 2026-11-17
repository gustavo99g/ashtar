/**
 * A pilha de cartões da janela dos avisos (`model/cards.ts`). Só existe nessa janela.
 */
import { create } from "zustand";
import { type Card, type CardInput, dropCard, pushCard } from "../model/cards";

interface Stack {
	cards: Card[];
	/** Cresce a cada cartão que chega: é a `version` dele. */
	counter: number;
}

export const useStack = create<Stack>()(() => ({ cards: [], counter: 0 }));

export function addCard(input: CardInput): void {
	useStack.setState((stack) => ({
		cards: pushCard(stack.cards, input, stack.counter + 1),
		counter: stack.counter + 1,
	}));
}

export function removeCard(key: string): void {
	useStack.setState((stack) => ({ cards: dropCard(stack.cards, key) }));
}

/** Para os testes. */
export function clearStack(): void {
	useStack.setState({ cards: [], counter: 0 });
}

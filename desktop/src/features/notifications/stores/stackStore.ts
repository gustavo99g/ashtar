/**
 * A pilha de cartões da janela dos avisos (`model/cards.ts`). Só existe nessa janela.
 */
import { create } from "zustand";
import { type Card, type CardInput, dropCard, pushCard } from "../model/cards";
import type { RingCard } from "../model/ring";

interface Stack {
	cards: Card[];
	/** Cresce a cada cartão que chega: é a `version` dele. */
	counter: number;
	/** A ligação tocando, que fica em cima da pilha (ADR 0023). */
	ring: RingCard | null;
}

export const useStack = create<Stack>()(() => ({
	cards: [],
	counter: 0,
	ring: null,
}));

/** Põe ou tira (`null`) o cartão da ligação. */
export function setRing(ring: RingCard | null): void {
	useStack.setState({ ring });
}

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
	useStack.setState({ cards: [], counter: 0, ring: null });
}

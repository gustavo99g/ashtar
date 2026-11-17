/**
 * A janela dos avisos inteira (`notifications.html`): a pilha de até três cartões no canto da tela.
 *
 * Cada cartão some sozinho quando a barra dourada de baixo termina ([`CARD_MS`]). Um cartão
 * atualizado (mensagem nova na mesma conversa) começa a barra de novo, e o mouse em cima da pilha
 * pausa todas. Clicar abre o que o cartão aponta na janela principal; o X só fecha.
 *
 * A janela tem o tamanho da pilha: a cada mudança, a altura vai para o Rust, que põe a janela no
 * canto (ou a esconde, sem cartões). O fundo é transparente; só os cartões aparecem.
 */
import { XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Avatar } from "@/features/identity";
import { useSettingsStore } from "@/features/settings";
import {
	notificationLayout,
	notificationOpen,
	onNotificationCard,
} from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { type Card, parseCard } from "../model/cards";
import { playSound } from "../model/sound";
import { addCard, removeCard, useStack } from "../stores/stackStore";

/** Quanto um cartão fica na tela. */
export const CARD_MS = 6000;

/** Recebe um cartão vindo da janela principal: entra na pilha e toca o som dele. */
export function receiveCard(value: unknown): void {
	const card = parseCard(value);
	if (!card) return;
	// O tema pode ter mudado na janela principal: as duas dividem o mesmo `localStorage`.
	void useSettingsStore.persist.rehydrate();
	addCard(card);
	if (card.sound) playSound(card.sound);
}

export function NotificationStack() {
	const cards = useStack((stack) => stack.cards);
	const list = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const stop = onNotificationCard(receiveCard);
		return () => void stop.then((unlisten) => unlisten());
	}, []);

	// A altura da pilha decide o tamanho da janela; sem cartões, ela some.
	useLayoutEffect(() => {
		const element = list.current;
		if (!element) return;
		const report = () =>
			void notificationLayout(
				cards.length === 0 ? 0 : Math.ceil(element.offsetHeight),
			).catch(() => {});
		report();
		const observer = new ResizeObserver(report);
		observer.observe(element);
		return () => observer.disconnect();
	}, [cards.length]);

	return (
		<div
			ref={list}
			role="region"
			aria-label="Avisos"
			className="group/stack flex flex-col gap-2 p-2"
		>
			{cards.map((card) => (
				<NotificationCard key={card.key} card={card} />
			))}
		</div>
	);
}

function NotificationCard({ card }: { card: Card }) {
	const open = () => {
		removeCard(card.key);
		void notificationOpen(card.target).catch(() => {});
	};

	return (
		<div
			data-slot="notification-card"
			className="relative w-full overflow-hidden rounded-2xl border border-border-strong bg-popover text-popover-foreground shadow-toast select-none"
		>
			<button
				type="button"
				onClick={open}
				aria-label={`${card.title}, ${card.context}: ${card.body}`}
				className="flex w-full items-start gap-3 py-3 pr-10 pl-3.5 text-left hover:bg-accent/40"
			>
				<Avatar
					nick={card.person.nick}
					displayName={card.person.displayName}
					size={36}
				/>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex min-w-0 items-baseline gap-1.5">
						<span className="truncate text-sm font-semibold text-foreground">
							{card.title}
						</span>
						<span className="truncate text-xs text-muted-foreground">
							{card.context}
						</span>
						{card.count > 1 && (
							<span className="ml-auto shrink-0 rounded-full bg-gold/15 px-1.5 text-[11px] font-semibold text-gold">
								{card.count} novas
							</span>
						)}
					</span>
					<span className="line-clamp-2 text-xs leading-[1.45] text-secondary-foreground">
						{card.body}
					</span>
				</span>
			</button>
			<button
				type="button"
				aria-label="Fechar aviso"
				onClick={() => removeCard(card.key)}
				className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<XIcon className="size-3.5" />
			</button>
			<span
				key={card.version}
				aria-hidden="true"
				data-slot="notification-timer"
				onAnimationEnd={() => removeCard(card.key)}
				style={{ animationDuration: `${CARD_MS}ms` }}
				className={cn(
					"absolute inset-x-0 bottom-0 h-0.5 origin-left bg-gold opacity-55 animate-toast-timer",
					"group-hover/stack:[animation-play-state:paused]",
					"motion-reduce:opacity-0",
				)}
			/>
		</div>
	);
}

/**
 * O cartão da ligação recebida (quadro "Conversas — recebendo ligação", ADR 0023): fica em cima da
 * pilha da janela dos avisos enquanto toca, com o avatar de quem liga, "Ligando para você…",
 * Recusar, Atender e Responder com mensagem. Estando numa sala, o Atender vira "Sair e atender";
 * transmitindo, o cartão avisa que a transmissão acaba.
 *
 * O toque toca daqui, em repetição, enquanto o cartão existe (mais baixo para quem está numa
 * sala). Os botões não chamam a API: a resposta vai para a janela principal pelo Rust, e quem tira
 * o cartão é ela, quando a ligação muda. Se nada chegar, o cartão sai sozinho depois de
 * [`RING_GIVE_UP_MS`], para o toque nunca ficar preso.
 */
import { MessageSquareIcon, PhoneIcon, PhoneOffIcon } from "lucide-react";
import { useEffect } from "react";
import { Avatar } from "@/features/identity";
import { notificationAnswer } from "@/lib/tauri/commands";
import type { RingAction, RingCard } from "../model/ring";
import { startRingtone } from "../model/ringtone";
import { setRing } from "../stores/stackStore";

/** Um pouco mais que os 30 s da API: o `call.ended` chega antes, quase sempre. */
export const RING_GIVE_UP_MS = 40_000;

export function IncomingCall({ ring }: { ring: RingCard }) {
	const name = ring.person.displayName ?? ring.person.nick;

	useEffect(() => startRingtone(ring.inRoom), [ring.callId, ring.inRoom]);
	useEffect(() => {
		const timer = setTimeout(() => setRing(null), RING_GIVE_UP_MS);
		return () => clearTimeout(timer);
	}, [ring.callId]);

	function answer(action: RingAction) {
		void notificationAnswer({ callId: ring.callId, action }).catch(() => {});
	}

	return (
		<section
			data-slot="incoming-call"
			aria-label={`${name} está ligando para você`}
			className="flex w-full flex-col gap-3 rounded-2xl border border-gold/60 bg-popover p-3.5 text-popover-foreground shadow-toast select-none"
		>
			<div className="flex items-center gap-3">
				<span className="rounded-full ring-2 ring-gold ring-offset-2 ring-offset-popover motion-safe:animate-pulse">
					<Avatar
						nick={ring.person.nick}
						displayName={ring.person.displayName}
						size={40}
					/>
				</span>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate text-sm font-semibold text-foreground">
						{name}
					</span>
					<span className="flex items-center gap-1.5 text-xs text-gold">
						<PhoneIcon aria-hidden="true" className="size-3.5" />
						Ligando para você…
					</span>
				</span>
			</div>
			{ring.sharing && (
				<p className="text-xs leading-normal text-warning-text">
					Atender encerra a sua transmissão.
				</p>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => answer("decline")}
					className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive text-[13px] font-semibold text-destructive-foreground hover:bg-destructive-hover"
				>
					<PhoneOffIcon aria-hidden="true" className="size-4" />
					Recusar
				</button>
				<button
					type="button"
					onClick={() => answer("accept")}
					className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary-hover"
				>
					<PhoneIcon aria-hidden="true" className="size-4" />
					{ring.inRoom ? "Sair e atender" : "Atender"}
				</button>
			</div>
			<button
				type="button"
				onClick={() => answer("reply")}
				className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
			>
				<MessageSquareIcon aria-hidden="true" className="size-3.5" />
				Responder com mensagem
			</button>
		</section>
	);
}

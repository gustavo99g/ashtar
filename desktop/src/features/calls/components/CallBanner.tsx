/**
 * A faixa da ligação na janela da conversa (Etapa 20 da v0.3), entre o cabeçalho e o histórico:
 *
 * - **Chamando:** "Chamando fulano…" e Cancelar. Quem liga só sai da sala em que estava quando a
 *   outra pessoa atende.
 * - **Tocando:** "fulano está ligando", Recusar e Atender. É também o que aparece em Ocupado,
 *   quando a ligação não toca nem mostra o cartão (quadro "Conversas — ligação com status
 *   Ocupado").
 * - **Em ligação:** o tempo e "Voltar para a ligação", que leva à tela dela.
 *
 * Só aparece na conversa da ligação.
 */
import { PhoneIcon, PhoneOffIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useMaybeVoice } from "@/features/voice";
import { ApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { acceptRinging, cancelCalling, declineRinging } from "../actions";
import { useCallClock } from "../hooks/useCallClock";
import { clockLabel, otherPerson, personName } from "../model/machine";
import { useCallStore } from "../stores/callStore";

/** Faz a ação e, se a API recusar, diz por quê no aviso do canto. */
export function act(action: () => Promise<void>): void {
	action().catch((error: unknown) =>
		toast.add({
			title: "Não deu certo",
			description:
				error instanceof ApiError
					? error.message
					: "Tente de novo em instantes.",
		}),
	);
}

export function CallBanner({ channelId }: { channelId: string }) {
	const call = useCallStore((state) =>
		state.call?.channel_id === channelId ? state.call : null,
	);
	const phase = useCallStore((state) => state.phase);
	const me = useCallStore((state) => state.me);
	const voiceKind = useMaybeVoice()?.voiceKind ?? null;
	const navigate = useNavigate();
	const clock = useCallClock(
		phase === "in_call" ? (call?.answered_at ?? null) : null,
	);
	if (!call) return null;
	const name = personName(otherPerson(call, me));

	if (phase === "calling") {
		return (
			<Strip>
				<PhoneIcon aria-hidden="true" className="size-4 text-gold" />
				<span className="flex-1 truncate">Chamando {name}…</span>
				<Button
					variant="ghost"
					className="h-8 text-destructive-text"
					onClick={() => act(cancelCalling)}
				>
					Cancelar
				</Button>
			</Strip>
		);
	}
	if (phase === "ringing") {
		return (
			<Strip>
				<PhoneIcon aria-hidden="true" className="size-4 text-gold" />
				<span className="flex-1 truncate">{name} está ligando</span>
				<Button
					variant="danger"
					className="h-8"
					onClick={() => act(declineRinging)}
				>
					<PhoneOffIcon aria-hidden="true" />
					Recusar
				</Button>
				<Button className="h-8" onClick={() => act(acceptRinging)}>
					<PhoneIcon aria-hidden="true" />
					{voiceKind === "room" ? "Sair e atender" : "Atender"}
				</Button>
			</Strip>
		);
	}
	return (
		<Strip>
			<PhoneIcon aria-hidden="true" className="size-4 text-gold" />
			<span className="flex-1 truncate">
				{clock === null ? "Conectando…" : `Em ligação · ${clockLabel(clock)}`}
			</span>
			<Button
				variant="secondary"
				className="h-8"
				onClick={() => void navigate(paths.voiceRoom)}
			>
				Voltar para a ligação
			</Button>
		</Strip>
	);
}

function Strip({ children }: { children: React.ReactNode }) {
	return (
		<div
			role="status"
			className="flex shrink-0 items-center gap-2 border-b border-border bg-gold-wash px-3 py-2 text-[13px] font-medium text-foreground"
		>
			{children}
		</div>
	);
}

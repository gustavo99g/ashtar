/**
 * A ligação na lateral (Etapas 20 a 22 da v0.3):
 *
 * - **Aberta** (`SideCallCards`): cartões fixos no topo, acima das abas. Tocando, o avatar de quem
 *   liga com o anel dourado, Recusar e Atender (é o que fica em Ocupado, quando não toca nada).
 *   Chamando, "Chamando…" e Cancelar. Em ligação, o avatar com o telefone dourado e o tempo;
 *   clicar volta para a tela da ligação. Cada chamada perdida, com o telefone vermelho, a hora e
 *   "Ligar de volta"; clicar abre a conversa, e abrir a conversa a tira daqui.
 * - **Minimizada** (`SideCallAvatars`): só os avatares, com o anel, o telefone dourado ou o
 *   vermelho.
 *
 * Abrir a conversa é da `features/dms`: quem monta passa o `onOpenConversation`.
 */
import { PhoneIcon, PhoneMissedIcon, PhoneOffIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/features/identity";
import { useMaybeVoice } from "@/features/voice";
import type { Author } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import {
	acceptRinging,
	callPerson,
	cancelCalling,
	declineRinging,
} from "../actions";
import { useCallClock } from "../hooks/useCallClock";
import {
	type CallPhase,
	clockLabel,
	type MissedCall,
	otherPerson,
	personName,
} from "../model/machine";
import { useCallStore } from "../stores/callStore";
import { act } from "./CallBanner";

const NO_MISSED: MissedCall[] = [];

function useSideCall() {
	const call = useCallStore((state) => state.call);
	const phase = useCallStore((state) => state.phase);
	const me = useCallStore((state) => state.me);
	const missedMap = useCallStore((state) => state.missed);
	const missed = Object.values(missedMap);
	return {
		call,
		phase,
		person: call ? otherPerson(call, me) : null,
		missed: missed.length > 0 ? missed : NO_MISSED,
	};
}

function hourLabel(seconds: number): string {
	return new Date(seconds * 1000).toLocaleTimeString("pt-BR", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** O avatar com a marca da ligação: o anel dourado (tocando), o telefone dourado ou o vermelho. */
function CallAvatar({
	person,
	mark,
	size,
}: {
	person: Author;
	mark: "ring" | "live" | "missed";
	size: number;
}) {
	return (
		<span
			className={cn(
				"relative shrink-0 rounded-full",
				mark !== "missed" && "ring-2 ring-gold ring-offset-2 ring-offset-card",
				mark === "ring" && "motion-safe:animate-pulse",
			)}
		>
			<Avatar nick={person.nick} displayName={person.display_name} size={size} />
			{mark !== "ring" && (
				<span
					className={cn(
						"absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full border-2 border-card",
						mark === "live"
							? "bg-gold text-gold-foreground"
							: "bg-destructive text-destructive-foreground",
					)}
				>
					{mark === "live" ? (
						<PhoneIcon aria-hidden="true" className="size-[9px] stroke-[2.5]" />
					) : (
						<PhoneMissedIcon
							aria-hidden="true"
							className="size-[9px] stroke-[2.5]"
						/>
					)}
				</span>
			)}
		</span>
	);
}

function markOf(phase: CallPhase): "ring" | "live" {
	return phase === "connecting" || phase === "in_call" ? "live" : "ring";
}

export function SideCallCards({
	onOpenConversation,
}: {
	onOpenConversation: (channelId: string) => void;
}) {
	const { call, phase, person, missed } = useSideCall();
	if (!call && missed.length === 0) return null;
	return (
		<div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-2">
			{call && person && (
				<LiveCard phase={phase} person={person} answeredAt={call.answered_at} />
			)}
			{missed.map((entry) => (
				<Card key={entry.channelId}>
					<button
						type="button"
						onClick={() => onOpenConversation(entry.channelId)}
						className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
					>
						<CallAvatar person={entry.person} mark="missed" size={32} />
						<span className="flex min-w-0 flex-col">
							<span className="truncate text-[13px] font-semibold text-foreground">
								{personName(entry.person)}
							</span>
							<span className="text-xs text-destructive-text">
								Chamada perdida · {hourLabel(entry.at)}
							</span>
						</span>
					</button>
					<Button
						variant="secondary"
						className="h-8 px-2.5 text-xs"
						onClick={() => act(() => callPerson(entry.channelId))}
					>
						Ligar de volta
					</Button>
				</Card>
			))}
		</div>
	);
}

function LiveCard({
	phase,
	person,
	answeredAt,
}: {
	phase: CallPhase;
	person: Author;
	answeredAt: number | null;
}) {
	const navigate = useNavigate();
	const voiceKind = useMaybeVoice()?.voiceKind ?? null;
	const clock = useCallClock(phase === "in_call" ? answeredAt : null);
	const name = personName(person);

	if (phase === "ringing" || phase === "calling") {
		return (
			<Card>
				<CallAvatar person={person} mark="ring" size={32} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-[13px] font-semibold text-foreground">
						{name}
					</span>
					<span className="text-xs text-gold-text">
						{phase === "ringing" ? "Ligando para você…" : "Chamando…"}
					</span>
				</span>
				{phase === "ringing" ? (
					<>
						<Button
							variant="danger"
							aria-label="Recusar"
							title="Recusar"
							className="size-8 px-0"
							onClick={() => act(declineRinging)}
						>
							<PhoneOffIcon aria-hidden="true" />
						</Button>
						<Button
							aria-label={voiceKind === "room" ? "Sair e atender" : "Atender"}
							title={voiceKind === "room" ? "Sair e atender" : "Atender"}
							className="size-8 px-0"
							onClick={() => act(acceptRinging)}
						>
							<PhoneIcon aria-hidden="true" />
						</Button>
					</>
				) : (
					<Button
						variant="ghost"
						className="h-8 px-2 text-xs text-destructive-text"
						onClick={() => act(cancelCalling)}
					>
						Cancelar
					</Button>
				)}
			</Card>
		);
	}
	return (
		<Card>
			<button
				type="button"
				onClick={() => void navigate(paths.voiceRoom)}
				aria-label={`Voltar para a ligação com ${name}`}
				className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
			>
				<CallAvatar person={person} mark="live" size={32} />
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-[13px] font-semibold text-foreground">
						{name}
					</span>
					<span className="text-xs text-gold-text">
						{clock === null ? "Conectando…" : `Em ligação · ${clockLabel(clock)}`}
					</span>
				</span>
			</button>
		</Card>
	);
}

function Card({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center gap-2.5 rounded-lg bg-secondary/60 px-2.5 py-2">
			{children}
		</div>
	);
}

export function SideCallAvatars({
	onOpenConversation,
}: {
	onOpenConversation: (channelId: string) => void;
}) {
	const { call, phase, person, missed } = useSideCall();
	const navigate = useNavigate();
	if (!call && missed.length === 0) return null;
	const live = phase === "connecting" || phase === "in_call";
	return (
		<>
			{call && person && (
				<button
					type="button"
					aria-label={
						live
							? `Voltar para a ligação com ${personName(person)}`
							: `${personName(person)}: ligação tocando`
					}
					title={personName(person)}
					onClick={() =>
						live
							? void navigate(paths.voiceRoom)
							: onOpenConversation(call.channel_id)
					}
					className="flex size-9 items-center justify-center"
				>
					<CallAvatar person={person} mark={markOf(phase)} size={28} />
				</button>
			)}
			{missed.map((entry) => (
				<button
					key={entry.channelId}
					type="button"
					aria-label={`Chamada perdida de ${personName(entry.person)}`}
					title={`Chamada perdida · ${hourLabel(entry.at)}`}
					onClick={() => onOpenConversation(entry.channelId)}
					className="flex size-9 items-center justify-center"
				>
					<CallAvatar person={entry.person} mark="missed" size={28} />
				</button>
			))}
			<span aria-hidden="true" className="h-px w-6 bg-border" />
		</>
	);
}

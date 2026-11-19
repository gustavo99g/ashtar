/**
 * O registro de uma ligação no histórico (Etapa 22 da v0.3): a mensagem `kind = "call"` vira uma
 * linha própria, centrada, com o telefone, o resultado e a hora ou a duração: "Ligação encerrada ·
 * 12:04", "Chamada perdida · 17:52", "Ligação recusada". Embaixo, "Ligar de novo" ou, na perdida
 * de quem não atendeu, "Ligar de volta".
 *
 * O registro é de quem ligou (o autor da mensagem), então "minha" quer dizer "eu liguei".
 */
import { PhoneIcon, PhoneMissedIcon, PhoneOffIcon } from "lucide-react";
import type { Author, Message, Shown } from "@/lib/api";
import { cn } from "@/lib/utils";
import { clockLabel, outcomeLabel } from "../model/machine";
import { CallButton } from "./CallButton";

/** A hora do registro, como o resto do histórico: "17:52". */
function hourLabel(seconds: number): string {
	return new Date(seconds * 1000).toLocaleTimeString("pt-BR", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function CallEntry({
	message,
	myId,
	person,
	presence,
}: {
	message: Message;
	myId: string | null;
	/** A outra pessoa da conversa, para quem o "Ligar de novo" liga. */
	person: Author | null;
	/** O status dela; `null` offline. */
	presence: Shown | null;
}) {
	const record = message.call;
	if (!record) return null;
	const mine = message.author.id === myId;
	const { outcome, duration } = record;
	const missedForMe = outcome === "missed" && !mine;
	const detail =
		outcome === "answered" && duration !== null
			? clockLabel(duration)
			: hourLabel(message.created_at);
	const Icon =
		outcome === "answered"
			? PhoneIcon
			: missedForMe
				? PhoneMissedIcon
				: PhoneOffIcon;

	return (
		<div
			data-slot="call-entry"
			className="mx-4 my-2 flex flex-col items-center gap-1 rounded-lg py-1.5 text-center"
		>
			<span
				className={cn(
					"flex items-center gap-1.5 text-[13px] font-semibold",
					missedForMe ? "text-destructive-text" : "text-secondary-foreground",
				)}
			>
				<Icon aria-hidden="true" className="size-4" />
				{outcomeLabel(outcome, mine)}
				<span className="font-normal text-muted-foreground">· {detail}</span>
			</span>
			{person && (
				<CallButton
					variant="link"
					text={missedForMe ? "Ligar de volta" : "Ligar de novo"}
					person={person}
					presence={presence}
					resolveDm={() => Promise.resolve(message.channel_id)}
				/>
			)}
		</div>
	);
}

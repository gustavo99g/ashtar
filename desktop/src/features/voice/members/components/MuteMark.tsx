import { HeadphoneOffIcon, MicOffIcon, ShieldIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelMember } from "../model/members";

/*
 * O microfone ou o áudio desligado de alguém, em vermelho (v0.8). O que a moderação impôs ganha o
 * escudo ao lado (ADR 0034, quadro "Moderação — na voz"): sem escudo, a pessoa se mutou.
 */
export function MuteMark({
	member,
	className,
}: {
	member: Pick<ChannelMember, "micOff" | "deafened" | "serverMuted" | "serverDeafened">;
	/** O tamanho dos ícones (`size-3.5`). */
	className: string;
}) {
	const deafened = member.deafened || member.serverDeafened;
	const muted = member.micOff || member.serverMuted;
	if (!deafened && !muted) return null;
	const moderated = deafened ? member.serverDeafened : member.serverMuted;
	const Icon = deafened ? HeadphoneOffIcon : MicOffIcon;
	const label = moderated
		? deafened
			? "Áudio desligado pela moderação"
			: "Silenciado pela moderação"
		: deafened
			? "áudio desativado"
			: "microfone desativado";
	return (
		<span
			title={moderated ? label : undefined}
			className="flex shrink-0 items-center gap-px"
		>
			<Icon
				aria-label={label}
				className={cn(className, "shrink-0 text-destructive-border")}
			/>
			{moderated && (
				<ShieldIcon
					aria-hidden="true"
					className={cn(className, "shrink-0 fill-current text-destructive-border")}
				/>
			)}
		</span>
	);
}

/** O escudo pequeno no canto de um botão de microfone ou de áudio travado pela moderação. */
export function ShieldBadge() {
	return (
		<ShieldIcon
			aria-hidden="true"
			className="absolute -right-0.5 -bottom-0.5 size-3! fill-current text-destructive-border"
		/>
	);
}

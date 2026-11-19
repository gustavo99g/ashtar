import { FeatherIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	setShareQuality,
	shareSettingsOf,
	useShareVolume,
} from "../stores/shareVolumeStore";

/**
 * A qualidade que quem assiste pede para a transmissão de `owner` (ADR 0024): Automática (a camada
 * segue o tamanho do bloco) ou Leve (sempre a camada leve, mesmo grande ou em tela cheia). Fica
 * guardada por quem transmite, e quem transmite não fica sabendo. Sem camada leve publicada, a
 * escolha não muda nada; o popover de como está chegando diz qual camada chega.
 */
export function ShareQualityButton({
	owner,
	name,
	compact = false,
}: {
	owner: string;
	name: string;
	/** O tamanho dos botões da miniatura. */
	compact?: boolean;
}) {
	const lite = useShareVolume(
		(state) => shareSettingsOf(state, owner).quality === "lite",
	);
	const label = lite
		? `Qualidade Leve para ${name}: voltar para a Automática`
		: `Qualidade Automática para ${name}: passar para a Leve`;
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={lite}
			title={lite ? "Qualidade: Leve" : "Qualidade: Automática"}
			onClick={() => setShareQuality(owner, lite ? "auto" : "lite")}
			className={cn(
				"flex shrink-0 items-center justify-center gap-1 rounded-lg bg-rail/85 font-semibold hover:bg-secondary",
				compact
					? "h-7 rounded-md px-2 text-[11px] [&_svg]:size-3.5"
					: "h-9 px-2.5 text-xs [&_svg]:size-4",
				lite ? "text-primary" : "text-foreground",
			)}
		>
			<FeatherIcon aria-hidden="true" />
			{lite ? "Leve" : "Auto"}
		</button>
	);
}

import { Volume1Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
	MAX_USER_VOLUME,
	setUserVolume,
	toggleUserMuted,
	useHeardVolume,
} from "../stores/userVolumeStore";

/*
 * O volume de uma pessoa, só para quem ajusta (ADR 0020): o controle de 0 a 200%, o número e o
 * alto-falante, que silencia só para você e, de novo, volta ao volume de antes. Aparece no cartão
 * da pessoa e no clique do bloco dela na grade.
 */
export function UserVolume({ userId, name }: { userId: string; name: string }) {
	const heard = useHeardVolume(userId);
	const SpeakerIcon =
		heard === 0 ? VolumeXIcon : heard < 50 ? Volume1Icon : Volume2Icon;
	return (
		<section aria-label={`Volume de ${name}`} className="flex flex-col gap-1.5">
			<span className="flex justify-between text-xs text-muted-foreground">
				<span>
					Volume de <strong className="text-foreground">{name}</strong>
				</span>
				<span
					className={cn(
						"font-mono",
						heard > 100 ? "text-live" : "text-foreground",
					)}
				>
					{heard}%
				</span>
			</span>
			<div className="flex items-center gap-2.5">
				<button
					type="button"
					aria-label={`Silenciar ${name} só para você`}
					aria-pressed={heard === 0}
					title="Silenciar só para você"
					onClick={() => toggleUserMuted(userId)}
					className={cn(
						"-my-1.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] hover:bg-secondary",
						heard === 0 ? "text-destructive-border" : "text-foreground",
					)}
				>
					<SpeakerIcon aria-hidden="true" className="size-4" />
				</button>
				<Slider
					aria-label={`Volume de ${name}`}
					min={0}
					max={MAX_USER_VOLUME}
					value={heard}
					onValueChange={(value) => setUserVolume(userId, value)}
				/>
			</div>
			<span className="text-[11px] text-foreground-subtle">
				Só você ouve a diferença. Clique no alto-falante para silenciar; clique
				de novo e volta ao volume de antes.
			</span>
		</section>
	);
}

/**
 * A marca de quem não está em 100%, no canto do bloco: a porcentagem, ou o alto-falante cortado
 * de quem você silenciou. Só você vê. Em 100% não desenha nada.
 */
export function UserVolumeMark({
	userId,
	className,
}: {
	userId: string;
	className?: string;
}) {
	const heard = useHeardVolume(userId);
	if (heard === 100) return null;
	return (
		<span
			aria-label={
				heard === 0 ? "silenciado só para você" : `volume em ${heard}% para você`
			}
			className={cn(
				"flex items-center rounded-md bg-rail/80 font-mono font-medium",
				heard === 0 ? "text-destructive-border" : "text-foreground",
				className,
			)}
		>
			{heard === 0 ? (
				<VolumeXIcon aria-hidden="true" className="size-[1.1em]" />
			) : (
				`${heard}%`
			)}
		</span>
	);
}

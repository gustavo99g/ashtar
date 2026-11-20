import {
	Select,
	SelectContent,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	QUALITY_ORDER,
	QUALITY_PRESETS,
	SHARE_AUDIO_OPTIONS,
} from "../model/presets";
import {
	type ShareAudioChoice,
	setShareDefaults,
	useShareDefaults,
} from "../stores/shareDefaultsStore";
import type { Quality } from "@/lib/tauri/commands";

const AUDIO_ORDER: ShareAudioChoice[] = ["application", "system", "off"];

/** Com o que o seletor de fontes abre: a qualidade e o áudio. Mudar lá vale só para aquela vez. */
export function ShareDefaultsSection() {
	const { quality, audio } = useShareDefaults();
	const qualities = QUALITY_ORDER.map((value) => ({
		value,
		label: `${QUALITY_PRESETS[value].label} · ${QUALITY_PRESETS[value].spec} fps`,
	}));
	const audios = AUDIO_ORDER.map((value) => ({
		value,
		label: SHARE_AUDIO_OPTIONS[value].label,
	}));
	return (
		<>
			<div className="grid gap-5 @xl:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-2">
					<Select
						items={qualities}
						value={quality}
						onValueChange={(next) =>
							next && setShareDefaults({ quality: next as Quality })
						}
					>
						<SelectLabel>Qualidade padrão</SelectLabel>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{qualities.map((option) => (
								<SelectItem
									key={option.value}
									value={option.value}
									label={option.label}
								>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex min-w-0 flex-col gap-2">
					<Select
						items={audios}
						value={audio}
						onValueChange={(next) =>
							next && setShareDefaults({ audio: next as ShareAudioChoice })
						}
					>
						<SelectLabel>Áudio padrão</SelectLabel>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{audios.map((option) => (
								<SelectItem
									key={option.value}
									value={option.value}
									label={option.label}
								>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<p className="text-xs text-muted-foreground">
				Conteúdo protegido, como filmes de serviços de streaming, pode aparecer
				preto para quem assiste.
			</p>
		</>
	);
}

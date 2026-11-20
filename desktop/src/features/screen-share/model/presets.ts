/**
 * Presets de qualidade da transmissão (o combinado do PLAN da v0.2.4: Leve, Movimento e Nitidez).
 *
 * O Rust recebe só a chave (`720p60`...) e decide tudo o mais: a caixa máxima, o fps, o bitrate
 * e o codec (`media/quality.rs`). Daqui saem só os textos do seletor, do painel e de quem assiste.
 * Mudou lá, muda aqui.
 */
import type { AudioMode, Quality } from "@/lib/tauri/commands";

export interface QualityPreset {
	label: string;
	spec: string;
	/** O fps do preset, igual ao de `media/quality.rs`: o painel mostra "58 de 60 fps". */
	fps: number;
	description: string;
	/** O teto do preset, igual ao `bitrate_bps` de `media/quality.rs`: o painel compara com ele. */
	bitrateKbps: number;
}

export const QUALITY_PRESETS = {
	"720p60": {
		label: "Leve",
		spec: "720p · 60",
		fps: 60,
		description:
			"Para upload fraco ou placa de vídeo antiga: menos nitidez, a mesma fluidez.",
		bitrateKbps: 4_000,
	},
	"1080p60": {
		label: "Movimento",
		spec: "1080p · 60",
		fps: 60,
		description: "Para jogos e vídeos: prioriza a fluidez.",
		bitrateKbps: 8_000,
	},
	"1080p30": {
		label: "Nitidez",
		spec: "1080p · 30",
		fps: 30,
		description:
			"Para código e documentos: mais bits por quadro, texto mais limpo.",
		bitrateKbps: 6_000,
	},
} satisfies Record<Quality, QualityPreset>;

/** Ordem em que o seletor e o painel mostram os presets. */
export const QUALITY_ORDER: readonly Quality[] = [
	"720p60",
	"1080p60",
	"1080p30",
];

export const DEFAULT_QUALITY: Quality = "1080p60";

/**
 * A rede está segurando a transmissão: a LiveKit pede bem menos que o teto do preset. Abaixo de
 * 70% o painel avisa.
 */
export function networkLimited(quality: Quality, targetKbps: number): boolean {
	return targetKbps < QUALITY_PRESETS[quality].bitrateKbps * 0.7;
}

/** As opções de áudio da transmissão, no seletor e no padrão de Configurações › Voz e vídeo. */
export const SHARE_AUDIO_OPTIONS: Record<
	AudioMode["mode"],
	{ label: string; hint: string }
> = {
	off: { label: "Sem áudio", hint: "O compartilhamento vai sem som." },
	application: {
		label: "Só do aplicativo",
		hint: "Apenas o som da janela escolhida.",
	},
	system: {
		label: "Todo o sistema",
		hint: "Tudo que toca no computador, menos as vozes da chamada.",
	},
};

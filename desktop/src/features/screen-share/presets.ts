/**
 * Presets de qualidade do compartilhamento (decisão 16 do PLAN.md).
 *
 * O Rust recebe só a chave (`720p60`...) e decide a caixa máxima, o fps da captura e o limite do
 * `FrameGate` (`media/quality.rs`). Daqui saem os textos do seletor e a configuração do encoder
 * no LiveKit.
 *
 * O fps existe nos dois lados: `maxFramerate` repete o `fps` de `media/quality.rs`. O Rust captura
 * nesse ritmo, e um valor menor aqui faria o encoder descartar frames já capturados. Mudou lá,
 * muda aqui.
 */
import type { Quality } from "@/lib/tauri/commands";

export interface QualityPreset {
	label: string;
	spec: string;
	description: string;
	maxBitrate: number;
	/** Igual ao `fps` do mesmo preset em `media/quality.rs`. */
	maxFramerate: number;
	/** O que o encoder preserva quando a banda aperta: fluidez ou nitidez. */
	contentHint: "motion" | "detail";
	degradationPreference: RTCDegradationPreference;
}

export const QUALITY_PRESETS = {
	"720p60": {
		label: "Movimento",
		spec: "720p · 60",
		description: "Para jogos e vídeos: prioriza a fluidez.",
		maxBitrate: 3_500_000,
		maxFramerate: 60,
		contentHint: "motion",
		degradationPreference: "maintain-framerate",
	},
	"900p60": {
		label: "Equilibrado",
		spec: "900p · 60",
		description:
			"Mais nitidez sem perder fluidez. Exige mais do computador e da conexão.",
		maxBitrate: 4_500_000,
		maxFramerate: 60,
		contentHint: "motion",
		degradationPreference: "maintain-framerate",
	},
	"1080p30": {
		label: "Nitidez",
		spec: "1080p · 30",
		description: "Para código e documentos: prioriza a leitura do texto.",
		maxBitrate: 4_500_000,
		maxFramerate: 30,
		contentHint: "detail",
		degradationPreference: "maintain-resolution",
	},
} satisfies Record<Quality, QualityPreset>;

/** Ordem em que o seletor mostra os presets. */
export const QUALITY_ORDER: readonly Quality[] = [
	"720p60",
	"900p60",
	"1080p30",
];

export const DEFAULT_QUALITY: Quality = "720p60";

/**
 * Os modelos de convite como a tela mostra. Quem decide os números é a API (ADR 0011): o app manda
 * só o `preset`, e no "Do seu jeito" a validade e as pessoas. Os números de "Para uma pessoa" e
 * "Para o grupo" aqui servem só para o resumo antes de criar; o bilhete usa o que a API devolveu.
 */
import type { Preset } from "@/lib/api";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PRESETS: Record<Preset, { title: string; summary: string }> = {
	person: { title: "Para uma pessoa", summary: "7 dias · 1 pessoa" },
	group: { title: "Para o grupo", summary: "5 minutos · até 8 pessoas" },
	custom: { title: "Do seu jeito", summary: "Você escolhe" },
};

/** O que a API usa em cada modelo fixo, para o "Vale até..." antes de criar. */
export const PRESET_LIMITS = {
	person: { ttlSecs: 7 * DAY, maxUses: 1 },
	group: { ttlSecs: 5 * MINUTE, maxUses: 8 },
} as const;

/** As validades do "Do seu jeito", na ordem do quadro. */
export const CUSTOM_TTLS = [
	{ value: "1h", label: "1 hora", secs: HOUR },
	{ value: "1d", label: "1 dia", secs: DAY },
	{ value: "7d", label: "7 dias", secs: 7 * DAY },
	{ value: "30d", label: "30 dias", secs: 30 * DAY },
] as const;

export type CustomTtl = (typeof CUSTOM_TTLS)[number]["value"];

/** De 1 a 50 pessoas no "Do seu jeito", como a API aceita. */
export const MIN_USES = 1;
export const MAX_USES = 50;

/** O título do bilhete: "Convite para uma pessoa", "Convite para o grupo", "Convite para 4 pessoas". */
export function ticketTitle(preset: Preset | null, maxUses: number): string {
	if (preset === "group") return "Convite para o grupo";
	return maxUses === 1
		? "Convite para uma pessoa"
		: `Convite para ${maxUses} pessoas`;
}

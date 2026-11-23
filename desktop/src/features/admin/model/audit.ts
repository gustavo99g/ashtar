import type { AuditEntry, AuditKind } from "@/lib/api";

/*
 * Os textos do Painel › Registro (quadro "Painel de controle — registro", v0.8, decisão 18): a
 * API guarda a chave da ação e os nomes da hora; aqui vira a frase "silenciou o microfone de rafa".
 */

/** Os filtros, na ordem da tela. `null` é Tudo. */
export const AUDIT_FILTERS: { kind: AuditKind | null; label: string }[] = [
	{ kind: null, label: "Tudo" },
	{ kind: "voice", label: "Voz" },
	{ kind: "members", label: "Membros" },
	{ kind: "invites", label: "Convites" },
	{ kind: "channels", label: "Canais" },
];

export const KIND_LABEL: Record<AuditKind, string> = {
	voice: "Voz",
	members: "Membros",
	invites: "Convites",
	channels: "Canais",
};

/** A frase da ação, em partes: o texto e, em destaque, os nomes. */
export type Phrase = { text: string; strong?: boolean }[];

function t(text: string): { text: string } {
	return { text };
}

function b(text: string): { text: string; strong: true } {
	return { text, strong: true };
}

/** "silenciou o microfone de **rafa**". Uma chave que esta versão não conhece mostra a própria chave. */
export function auditPhrase(entry: AuditEntry): Phrase {
	const who = entry.target?.name ?? "";
	const detail = entry.detail ?? "";
	switch (entry.action) {
		case "voz.silenciar":
			return [t("silenciou o microfone de "), b(who)];
		case "voz.liberar_microfone":
			return [t("liberou o microfone de "), b(who)];
		case "voz.surdo":
			return [t("desligou o áudio de "), b(who)];
		case "voz.liberar_audio":
			return [t("devolveu o áudio de "), b(who)];
		case "voz.desligar_camera":
			return [t("desligou a câmera de "), b(who)];
		case "voz.encerrar_transmissao":
			return [t("encerrou a transmissão de "), b(who)];
		case "voz.mover":
			return [t("moveu "), b(who), t(" para "), b(detail)];
		case "voz.desconectar":
			return [t("desconectou "), b(who), t(" da sala")];
		case "membros.remover":
			return [t("removeu "), b(who), t(" do grupo")];
		case "membros.desvincular":
			return [t("desvinculou o computador de "), b(who)];
		case "permissoes.dar":
			return [t("deu "), b(detail), t(" para "), b(who)];
		case "permissoes.tirar":
			return [t("tirou "), b(detail), t(" de "), b(who)];
		case "convites.criar":
			return [t("criou um convite "), b(detail.toLowerCase())];
		case "convites.recuperacao":
			return [t("criou uma recuperação para "), b(who)];
		case "convites.revogar":
			return [t("revogou um convite")];
		case "canais.criar":
			return [t("criou "), b(entry.place ?? "")];
		case "canais.renomear":
			return [t("renomeou "), b(entry.place ?? ""), t(" para "), b(detail)];
		case "canais.acesso":
			return [t("mudou quem acessa "), b(entry.place ?? ""), t(`: ${detail.toLowerCase()}`)];
		case "canais.arquivar":
			return [t("arquivou "), b(entry.place ?? "")];
		case "canais.desarquivar":
			return [t("desarquivou "), b(entry.place ?? "")];
		default:
			return [t(entry.action)];
	}
}

/** A coluna Onde: a sala ou o canal; sem lugar, a parte do Painel. */
export function auditPlace(entry: AuditEntry): string {
	if (entry.kind === "channels") return KIND_LABEL.channels;
	if (entry.place) return entry.place;
	if (entry.action.startsWith("permissoes.")) return "Permissões";
	return KIND_LABEL[entry.kind];
}

const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "hoje, 22:20", "ontem, 23:02", "18 nov, 20:11". `now` em milissegundos. */
export function auditWhen(at: number, now = Date.now()): string {
	const date = new Date(at * 1000);
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const day = new Date(date);
	day.setHours(0, 0, 0, 0);
	const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
	const prefix =
		days === 0
			? "hoje"
			: days === 1
				? "ontem"
				: dayFormat.format(date).replace(".", "").replace(" de ", " ");
	return `${prefix}, ${timeFormat.format(date)}`;
}

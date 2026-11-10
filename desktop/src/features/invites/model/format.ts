/**
 * Os textos de data e de prazo dos convites a partir do que a API devolve. As datas da API vêm em
 * segundos (Unix); o "agora" vem em milissegundos (`Date.now()`), como no resto do app.
 */
import { shortDate } from "@/lib/date";

/** O endereço sem o protocolo e sem o código, em letra miúda no bilhete: `ashtar.exemplo.ts.net/invite/`. */
export function inviteAddress(link: string, code: string): string {
	const withoutScheme = link.replace(/^https?:\/\//, "");
	return withoutScheme.endsWith(code)
		? withoutScheme.slice(0, withoutScheme.length - code.length)
		: withoutScheme;
}

const timeFormat = new Intl.DateTimeFormat("pt-BR", {
	hour: "2-digit",
	minute: "2-digit",
});

/** "12:20": a hora em que vence, no fuso do computador. `expiresAt` em segundos (Unix). */
export function expiryTime(expiresAt: number): string {
	return timeFormat.format(new Date(expiresAt * 1000));
}

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
	const day = new Date(ms);
	day.setHours(0, 0, 0, 0);
	return day.getTime();
}

/** "hoje, 12:20", "amanhã, 12:15", "ontem, 18:40" ou "24 out, 12:15". */
export function dayAndTime(at: number, now: number): string {
	const days = Math.round((startOfDay(at * 1000) - startOfDay(now)) / DAY_MS);
	const day =
		days === 0
			? "hoje"
			: days === 1
				? "amanhã"
				: days === -1
					? "ontem"
					: shortDate(at);
	return `${day}, ${expiryTime(at)}`;
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** Um prazo em segundos: "5 minutos", "1 hora", "7 dias". */
export function duration(secs: number): string {
	if (secs < 3600) {
		const minutes = Math.max(1, Math.ceil(secs / 60));
		return minutes === 60 ? "1 hora" : plural(minutes, "minuto", "minutos");
	}
	if (secs < 86_400) {
		const hours = Math.round(secs / 3600);
		return hours === 24 ? "1 dia" : plural(hours, "hora", "horas");
	}
	return plural(Math.round(secs / 86_400), "dia", "dias");
}

/** "1 pessoa" ou "até 8 pessoas". */
export function peopleText(maxUses: number): string {
	return maxUses === 1 ? "1 pessoa" : `até ${maxUses} pessoas`;
}

/** Quando foi criado, como no histórico: "agora", "hoje, 09:30", "ontem, 18:40" ou "em 15 out, 20:10". */
export function createdWhen(at: number, now: number): string {
	if (now - at * 1000 < 60_000) return "agora";
	const when = dayAndTime(at, now);
	return when.startsWith("hoje") || when.startsWith("ontem")
		? when
		: `em ${when}`;
}

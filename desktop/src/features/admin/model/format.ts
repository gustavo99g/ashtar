/** Os textos das telas do Painel: tamanhos, datas e durações. As datas da API vêm em segundos. */

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
});

/** "20 de nov., 21:14". */
export function when(at: number): string {
	return dateFormat.format(new Date(at * 1000));
}

/** "312 KB", "4,2 MB", "38 GB". */
export function size(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const digits = value < 10 && unit > 0 ? 1 : 0;
	return `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** "3 dias e 4 h", "5 h e 12 min", "8 min". */
export function duration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days} ${days === 1 ? "dia" : "dias"} e ${hours % 24} h`;
	if (hours > 0) return `${hours} h e ${minutes % 60} min`;
	return `${minutes} min`;
}

/** "há 5 min", "há 3 h", "há 2 dias". `now` em segundos. */
export function ago(at: number, now: number): string {
	const seconds = Math.max(0, now - at);
	if (seconds < 60) return "agora";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `há ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `há ${hours} h`;
	const days = Math.floor(hours / 24);
	return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

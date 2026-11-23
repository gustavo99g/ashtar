/** "agora", "há 12 min", "há 1 h 05 min": há quanto tempo o jogo abriu. */
export function playTime(startedMs: number, now: number): string {
	const minutes = Math.max(0, Math.floor((now - startedMs) / 60_000));
	if (minutes < 1) return "agora";
	if (minutes < 60) return `há ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0
		? `há ${hours} h`
		: `há ${hours} h ${String(rest).padStart(2, "0")} min`;
}

/** "hoje", "ontem", "há 3 dias", "12/10": a última vez que o jogo abriu. */
export function lastSeenLabel(at: number, now: number): string {
	const day = (time: number) => {
		const date = new Date(time);
		return new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
		).getTime();
	};
	const days = Math.round((day(now) - day(at)) / 86_400_000);
	if (days <= 0) return "hoje";
	if (days === 1) return "ontem";
	if (days < 7) return `há ${days} dias`;
	const date = new Date(at);
	return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

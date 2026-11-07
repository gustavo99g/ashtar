/**
 * Datas curtas em português, como nos quadros. As datas da API vêm em segundos (Unix).
 */

/** Como no canvas: "24 out", sem o "de" e sem o ponto que o `Intl` põe. */
const MONTHS = [
	"jan",
	"fev",
	"mar",
	"abr",
	"mai",
	"jun",
	"jul",
	"ago",
	"set",
	"out",
	"nov",
	"dez",
];

/** "24 out". `at` em segundos. */
export function shortDate(at: number): string {
	const date = new Date(at * 1000);
	return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

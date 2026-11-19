/**
 * O que a aba Conversas mostra de cada conversa privada: a ordem, a busca, o começo da última
 * mensagem e há quanto tempo foi. Tudo função pura, com os testes ao lado.
 */
import type { CallOutcome, Conversation, Person, Shown } from "@/lib/api";

/** O nome que aparece: o nome visível ou, sem ele, o nick. */
export function personName(person: {
	nick: string;
	display_name: string | null;
}): string {
	return person.display_name?.trim() || person.nick;
}

/** Sem acento e em minúsculas, para a busca achar "zé" com "ze". */
function plain(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

function matches(
	person: { nick: string; display_name: string | null },
	query: string,
): boolean {
	const wanted = plain(query.trim());
	if (!wanted) return true;
	return (
		plain(person.nick).includes(wanted) ||
		plain(person.display_name ?? "").includes(wanted)
	);
}

/**
 * As conversas da lista: só as que têm mensagem (a recém-aberta e vazia não aparece para
 * ninguém), filtradas pela busca; as com não lidas primeiro (`unreadOf`) e, dentro de cada grupo,
 * da que andou por último para a mais parada. Os ids das mensagens são UUID v7, então comparar o
 * texto é comparar a ordem de envio.
 */
export function listedConversations(
	conversations: Conversation[],
	query = "",
	unreadOf: (conversationId: string) => number = () => 0,
): Conversation[] {
	return conversations
		.filter((c) => c.last_message !== null && matches(c.person, query))
		.sort((a, b) => {
			const waiting = Number(unreadOf(b.id) > 0) - Number(unreadOf(a.id) > 0);
			if (waiting !== 0) return waiting;
			const left = a.last_message?.id ?? "";
			const right = b.last_message?.id ?? "";
			return left < right ? 1 : left > right ? -1 : 0;
		});
}

/**
 * Com quem dá para começar uma conversa: os membros que ainda não estão na lista, menos a própria
 * pessoa, filtrados pela busca e em ordem de nome.
 */
export function peopleToStart(
	people: Person[],
	conversations: Conversation[],
	myId: string | null,
	query = "",
): Person[] {
	const listed = new Set(
		listedConversations(conversations).map((c) => c.person.id),
	);
	return people
		.filter((p) => p.id !== myId && !listed.has(p.id) && matches(p, query))
		.sort((a, b) => personName(a).localeCompare(personName(b), "pt-BR"));
}

/**
 * O começo da última mensagem, numa linha só: "Você: fechou, depois da live". O registro de uma
 * ligação vira o resultado dela: "Chamada perdida", "Ligação encerrada".
 */
export function preview(conversation: Conversation, myId: string | null) {
	const last = conversation.last_message;
	if (!last) return "";
	if (last.kind === "call" && last.call) {
		return callPreview(last.call.outcome, last.author.id === myId);
	}
	const line = last.body.replace(/\s+/g, " ").trim();
	return last.author.id === myId ? `Você: ${line}` : line;
}

/** O registro de uma ligação na lista. `mine`: eu liguei. */
function callPreview(outcome: CallOutcome, mine: boolean): string {
	switch (outcome) {
		case "answered":
			return "Ligação encerrada";
		case "missed":
			return mine ? "Ninguém atendeu" : "Chamada perdida";
		case "declined":
			return "Ligação recusada";
		case "cancelled":
			return "Ligação cancelada";
		default:
			return "Ligação";
	}
}

/**
 * Há quanto tempo, curto, para o canto da linha: "agora", "3 min", a hora se foi hoje, "ontem", ou
 * o dia e o mês. `at` em segundos (o `created_at` da mensagem), `now` em milissegundos.
 */
export function agoLabel(at: number, now: number): string {
	const then = new Date(at * 1000);
	const today = new Date(now);
	const seconds = Math.floor(now / 1000) - at;
	if (seconds < 60) return "agora";
	if (seconds < 60 * 60) return `${Math.floor(seconds / 60)} min`;
	const startOfToday = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate(),
	).getTime();
	if (then.getTime() >= startOfToday) {
		return then.toLocaleTimeString("pt-BR", {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	if (then.getTime() >= startOfToday - 24 * 60 * 60 * 1000) return "ontem";
	return then.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** O status de quem está online, por id. Quem não está aqui está offline (ou invisível). */
export function presenceById(people: readonly Person[] | undefined): Map<string, Shown> {
	return new Map(
		(people ?? []).filter((p) => p.online).map((p) => [p.id, p.status]),
	);
}

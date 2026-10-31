/**
 * O aviso de quem entrou (quadros "Aviso: alguém entrou no grupo" e "Painel de controle:
 * estados"), decidido comparando duas consultas seguidas de `GET /api/members`. Sem React, para
 * testar no Vitest. Sem SSE na 0.2.2: o app do dono repete a consulta a cada 30 segundos, e o
 * WebSocket da 0.2.4 troca a consulta por um evento.
 */
import type { MemberView, Preset } from "@/lib/api";
import { memberName } from "./members";

export type JoinNotice =
	| {
			kind: "joined";
			/** Quem entrou com o mesmo convite entre as duas consultas, na ordem de entrada. */
			people: MemberView[];
			preset: Preset | null;
			/** Quantos já entraram com esse convite, e quantos cabem. */
			uses: number;
			maxUses: number;
	  }
	| { kind: "recovered"; person: MemberView };

/**
 * O que mudou de `before` para `after`. Membro novo (ativo e que não é o dono) vira "entrou",
 * juntando num aviso só quem entrou com o mesmo convite. Quem tinha uma recuperação pendente e
 * agora tem um computador vinculado depois do anterior vira "voltou".
 */
export function joinNotices(
	before: MemberView[],
	after: MemberView[],
): JoinNotice[] {
	const known = new Map(before.map((member) => [member.id, member]));
	const notices: JoinNotice[] = [];
	const byInvite = new Map<string, Extract<JoinNotice, { kind: "joined" }>>();

	for (const member of after) {
		const previous = known.get(member.id);
		if (!previous) {
			if (member.removed_at !== null || member.is_owner) continue;
			const joined = member.joined_with;
			const key = joined?.invite_id ?? `sem-convite:${member.id}`;
			const notice = byInvite.get(key);
			if (notice) {
				notice.people.push(member);
				notice.uses = Math.max(notice.uses, joined?.uses ?? 0);
			} else {
				const created: Extract<JoinNotice, { kind: "joined" }> = {
					kind: "joined",
					people: [member],
					preset: joined?.preset ?? null,
					uses: joined?.uses ?? 0,
					maxUses: joined?.max_uses ?? 0,
				};
				byInvite.set(key, created);
				notices.push(created);
			}
			continue;
		}
		const linkedAgain =
			member.device !== null &&
			member.device.linked_at !== previous.device?.linked_at;
		if (
			previous.pending_recovery &&
			linkedAgain &&
			member.removed_at === null
		) {
			notices.push({ kind: "recovered", person: member });
		}
	}
	return notices;
}

/** Os textos do aviso: os nomes (em negrito na tela), o resto do título e a linha de baixo. */
export function noticeText(notice: JoinNotice): {
	names: string[];
	title: string;
	description: string;
} {
	if (notice.kind === "recovered") {
		return {
			names: [memberName(notice.person)],
			title: "voltou",
			description: "Vinculou um computador novo com o convite de recuperação",
		};
	}
	const count =
		notice.maxUses > 1 ? ` · ${notice.uses} de ${notice.maxUses}` : "";
	const description =
		notice.preset === "group"
			? `Com o seu convite para o grupo${count}`
			: notice.preset === "person"
				? "Com o seu convite para uma pessoa"
				: notice.preset === "custom"
					? `Com o seu convite do seu jeito${count}`
					: "Com um convite";
	return {
		names: notice.people.map(memberName),
		title: notice.people.length === 1 ? "entrou no grupo" : "entraram no grupo",
		description,
	};
}

/**
 * Os textos de uma linha do histórico (quadro "Convites") a partir do `InviteView` da API. Sem
 * React, para testar no Vitest. A API não guarda o código: a linha diz o modelo, quem criou,
 * quem entrou e a situação.
 */
import type { InviteView, MemberRef } from "@/lib/api";
import { shortDate } from "@/lib/date";
import { createdWhen, duration } from "./format";

/** O ícone e a cor da linha. */
export type InviteRowKind = "person" | "group" | "recovery";

export interface InviteRow {
	kind: InviteRowKind;
	/** "Para uma pessoa", "Para o grupo", "Para 3 pessoas", "Recuperação de carlinha". */
	title: string;
	/** "Criado por você em 15 out, 20:10". */
	subtitle: string;
	/** "Ninguém entrou ainda", "thi entrou", "4 de 8 entraram". */
	usage: string;
	/** Quem entrou, num convite de várias pessoas: "lua, pedrin, carlinha e bruno". */
	who: string | null;
	/** Quanto da barra está cheio, de 0 a 100. */
	percent: number;
	/** O que vai debaixo da pílula: "Vence em 5 dias", "Durou 5 minutos", "Em 8 out". */
	note: string;
	/** Se ainda vale (a cor viva e o Revogar). */
	pending: boolean;
}

/** O nome que a tela mostra: o visível, ou o nick. */
export function personName(person: MemberRef): string {
	return person.display_name ?? person.nick;
}

/** "lua", "lua e pedrin", "lua, pedrin e bruno". */
export function joinNames(names: string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function title(invite: InviteView): string {
	if (invite.kind === "recovery") {
		return invite.target
			? `Recuperação de ${personName(invite.target)}`
			: "Recuperação";
	}
	if (invite.preset === "group") return "Para o grupo";
	return invite.max_uses === 1
		? "Para uma pessoa"
		: `Para ${invite.max_uses} pessoas`;
}

function subtitle(
	invite: InviteView,
	meId: string | undefined,
	now: number,
): string {
	const when = createdWhen(invite.created_at, now);
	if (invite.kind === "recovery")
		return `Trocar de computador · criado ${when}`;
	const by =
		invite.created_by.id === meId ? "você" : personName(invite.created_by);
	return `Criado por ${by} ${when}`;
}

function names(invite: InviteView): string[] {
	return invite.uses.map((use) => personName(use.user));
}

function usage(invite: InviteView): string {
	const entered = names(invite);
	const pending = invite.status === "pending";
	if (entered.length === 0) {
		if (invite.kind === "recovery")
			return pending ? "Ainda não foi usado" : "Não foi usado";
		return pending ? "Ninguém entrou ainda" : "Ninguém entrou";
	}
	if (invite.max_uses === 1) return `${entered[0]} entrou`;
	return `${entered.length} de ${invite.max_uses} entraram`;
}

function note(invite: InviteView, now: number): string {
	switch (invite.status) {
		case "pending":
			return `Vence em ${duration(invite.expires_at - now / 1000)}`;
		case "expired":
			return `Durou ${duration(invite.expires_at - invite.created_at)}`;
		case "revoked":
			return `Em ${shortDate(invite.revoked_at ?? invite.expires_at)}`;
		case "exhausted": {
			const last = invite.uses[invite.uses.length - 1];
			return `Em ${shortDate(last ? last.used_at : invite.expires_at)}`;
		}
	}
}

export function inviteRow(
	invite: InviteView,
	meId: string | undefined,
	now: number,
): InviteRow {
	const kind: InviteRowKind =
		invite.kind === "recovery"
			? "recovery"
			: invite.preset === "group"
				? "group"
				: "person";
	return {
		kind,
		title: title(invite),
		subtitle: subtitle(invite, meId, now),
		usage: usage(invite),
		who:
			invite.max_uses > 1 && invite.uses.length > 0
				? joinNames(names(invite))
				: null,
		percent: Math.min(
			100,
			Math.round((invite.uses.length / Math.max(1, invite.max_uses)) * 100),
		),
		note: note(invite, now),
		pending: invite.status === "pending",
	};
}

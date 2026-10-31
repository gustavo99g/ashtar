/**
 * Os textos e os filtros da lista de membros (quadro "Membros") a partir do `MemberView` da API.
 * Sem React, para testar no Vitest. A lista vem inteira numa chamada só (os removidos inclusive),
 * e os chips filtram aqui.
 */
import { shortDate } from "@/features/invites";
import type { MemberView } from "@/lib/api";

export type MemberFilter = "all" | "beta" | "noDevice" | "removed";

/** O nome que a tela mostra: o visível, ou o nick. */
export function memberName(
	member: Pick<MemberView, "nick" | "display_name">,
): string {
	return member.display_name ?? member.nick;
}

const FILTERS: Record<MemberFilter, (member: MemberView) => boolean> = {
	all: (m) => m.removed_at === null,
	beta: (m) => m.removed_at === null && m.beta !== null,
	noDevice: (m) => m.removed_at === null && m.device === null,
	removed: (m) => m.removed_at !== null,
};

export function filterMembers(
	members: MemberView[],
	filter: MemberFilter,
): MemberView[] {
	return members.filter(FILTERS[filter]);
}

/** O número de cada chip. */
export function filterCounts(
	members: MemberView[],
): Record<MemberFilter, number> {
	return {
		all: filterMembers(members, "all").length,
		beta: filterMembers(members, "beta").length,
		noDevice: filterMembers(members, "noDevice").length,
		removed: filterMembers(members, "removed").length,
	};
}

export type DeviceState = "linked" | "none" | "removed";

/** A coluna Computador: "Vinculado / desde 2 out", "Sem computador / Recuperação valendo até 23 out"... */
export function deviceText(member: MemberView): {
	state: DeviceState;
	label: string;
	detail: string;
} {
	if (member.removed_at !== null) {
		return {
			state: "removed",
			label: "Removido",
			detail: `em ${shortDate(member.removed_at)}`,
		};
	}
	const recovery = member.pending_recovery
		? `Recuperação valendo até ${shortDate(member.pending_recovery.expires_at)}`
		: null;
	if (member.device) {
		return {
			state: "linked",
			label: "Vinculado",
			detail: recovery ?? `desde ${shortDate(member.device.linked_at)}`,
		};
	}
	return {
		state: "none",
		label: "Sem computador",
		detail: recovery ?? "Precisa de um convite de recuperação",
	};
}

/** A coluna Entrou, debaixo da data: com que convite. */
export function joinedVia(member: MemberView): string {
	if (member.is_owner) return "Criou o grupo";
	switch (member.joined_with?.preset) {
		case "person":
			return "Convite seu";
		case "group":
			return "Convite do grupo";
		case "custom":
			return "Convite do seu jeito";
		default:
			return "Convite";
	}
}

/** Uma linha de "No grupo", na gaveta do membro. */
export interface MemberFact {
	title: string;
	detail: string;
}

const JOINED_WITH = {
	person: "Com um convite seu",
	group: "Com o convite do grupo",
	custom: "Com um convite do seu jeito",
} as const;

/** "Entrou em 2 out / Com um convite seu", ou "Criou o grupo em 1 out / É o dono". */
export function joinedFact(member: MemberView): MemberFact {
	const date = shortDate(member.created_at);
	if (member.is_owner)
		return { title: `Criou o grupo em ${date}`, detail: "É o dono" };
	const preset = member.joined_with?.preset;
	return {
		title: `Entrou em ${date}`,
		detail: preset ? JOINED_WITH[preset] : "Com um convite",
	};
}

/** "Computador vinculado / Desde 2 out", "Sem computador / ...", "Removido em 14 out / ...". */
export function deviceFact(member: MemberView): MemberFact {
	if (member.removed_at !== null) {
		return {
			title: `Removido em ${shortDate(member.removed_at)}`,
			detail: "As mensagens continuam no histórico",
		};
	}
	const { detail } = deviceText(member);
	return {
		title: member.device ? "Computador vinculado" : "Sem computador",
		detail: detail.charAt(0).toUpperCase() + detail.slice(1),
	};
}

/** "Canal beta / Ligado por você em 12 out", "Canal estável / ...". */
export function channelFact(member: MemberView): MemberFact {
	if (!member.beta)
		return {
			title: "Canal estável",
			detail: "Recebe as versões depois do beta",
		};
	if (member.is_owner)
		return { title: "Canal beta", detail: "O dono sempre recebe o beta" };
	const at = member.beta.granted_at;
	return {
		title: "Canal beta",
		detail: at ? `Ligado por você em ${shortDate(at)}` : "Ligado por você",
	};
}

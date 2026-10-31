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

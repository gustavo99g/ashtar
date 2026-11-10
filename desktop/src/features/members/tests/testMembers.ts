/** Membros de exemplo para os testes da feature (não entra no app). */
import type { MemberView } from "@/lib/api";

const DAY = 86_400;
export const NOW = Math.floor(new Date(2026, 9, 17, 12, 15).getTime() / 1000);

export function member(
	id: string,
	fields: Partial<MemberView> = {},
): MemberView {
	return {
		id,
		nick: id,
		display_name: null,
		is_owner: false,
		created_at: NOW - 10 * DAY,
		removed_at: null,
		device: { linked_at: NOW - 10 * DAY },
		beta: null,
		joined_with: { invite_id: "i-p", preset: "person", uses: 1, max_uses: 1 },
		pending_recovery: null,
		...fields,
	};
}

export const owner = member("kid", {
	is_owner: true,
	created_at: NOW - 16 * DAY,
	beta: { origin: "owner", granted_at: null },
	joined_with: null,
});

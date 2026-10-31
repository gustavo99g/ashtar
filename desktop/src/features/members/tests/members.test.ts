import { describe, expect, it } from "vitest";
import {
	deviceText,
	filterCounts,
	filterMembers,
	joinedVia,
	memberName,
} from "../members";
import { member, NOW, owner } from "./testMembers";

const DAY = 86_400;
const list = [
	owner,
	member("juliana", {
		display_name: "juju",
		beta: { origin: "direct", granted_at: NOW - DAY },
	}),
	member("carla", {
		device: null,
		pending_recovery: { invite_id: "r", expires_at: NOW + 6 * DAY },
	}),
	member("bruno", { device: null, removed_at: NOW - 3 * DAY }),
];

describe("lista de membros", () => {
	it("filtra no app e conta cada chip", () => {
		expect(filterMembers(list, "all").map((m) => m.id)).toEqual([
			"kid",
			"juliana",
			"carla",
		]);
		expect(filterMembers(list, "beta").map((m) => m.id)).toEqual([
			"kid",
			"juliana",
		]);
		expect(filterMembers(list, "noDevice").map((m) => m.id)).toEqual(["carla"]);
		expect(filterMembers(list, "removed").map((m) => m.id)).toEqual(["bruno"]);
		expect(filterCounts(list)).toEqual({
			all: 3,
			beta: 2,
			noDevice: 1,
			removed: 1,
		});
	});

	it("mostra o nome visível ou o nick", () => {
		expect(memberName(list[1])).toBe("juju");
		expect(memberName(owner)).toBe("kid");
	});

	it("diz o estado do computador", () => {
		expect(deviceText(owner)).toEqual({
			state: "linked",
			label: "Vinculado",
			detail: "desde 7 out",
		});
		expect(deviceText(list[2])).toEqual({
			state: "none",
			label: "Sem computador",
			detail: "Recuperação valendo até 23 out",
		});
		expect(deviceText(member("x", { device: null })).detail).toBe(
			"Precisa de um convite de recuperação",
		);
		expect(deviceText(list[3])).toEqual({
			state: "removed",
			label: "Removido",
			detail: "em 14 out",
		});
	});

	it("diz com que convite entrou", () => {
		expect(joinedVia(owner)).toBe("Criou o grupo");
		expect(joinedVia(member("a"))).toBe("Convite seu");
		expect(
			joinedVia(
				member("b", {
					joined_with: {
						invite_id: "g",
						preset: "group",
						uses: 3,
						max_uses: 8,
					},
				}),
			),
		).toBe("Convite do grupo");
		expect(
			joinedVia(
				member("c", {
					joined_with: {
						invite_id: "c",
						preset: "custom",
						uses: 1,
						max_uses: 4,
					},
				}),
			),
		).toBe("Convite do seu jeito");
	});
});

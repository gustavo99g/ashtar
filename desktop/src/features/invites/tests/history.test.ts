import { describe, expect, it } from "vitest";
import type { InviteView } from "@/lib/api";
import { inviteRow, joinNames } from "../history";

/** 17 out de 2026, 12:15: o "agora" dos quadros. */
const now = new Date(2026, 9, 17, 12, 15).getTime();
const at = (day: number, hour: number, minute: number) =>
	new Date(2026, 9, day, hour, minute).getTime() / 1000;
const kid = { id: "u-kid", nick: "kid", display_name: null };
const use = (nick: string, display: string | null, usedAt: number) => ({
	user: { id: `u-${nick}`, nick, display_name: display },
	used_at: usedAt,
});

function invite(fields: Partial<InviteView>): InviteView {
	return {
		id: "i1",
		kind: "new",
		preset: "person",
		status: "pending",
		created_by: kid,
		target: null,
		created_at: at(15, 20, 10),
		expires_at: at(22, 12, 15),
		revoked_at: null,
		max_uses: 1,
		uses: [],
		...fields,
	};
}

describe("linha do histórico", () => {
	it("um convite para uma pessoa que ainda vale", () => {
		expect(inviteRow(invite({}), "u-kid", now)).toEqual({
			kind: "person",
			title: "Para uma pessoa",
			subtitle: "Criado por você em 15 out, 20:10",
			usage: "Ninguém entrou ainda",
			who: null,
			percent: 0,
			note: "Vence em 5 dias",
			pending: true,
		});
	});

	it("o convite do grupo que expirou, com quem entrou", () => {
		const row = inviteRow(
			invite({
				preset: "group",
				status: "expired",
				created_at: at(12, 21, 2),
				expires_at: at(12, 21, 7),
				max_uses: 8,
				uses: [
					use("luana", "lua", at(12, 21, 3)),
					use("pedro.h", "pedrin", at(12, 21, 3)),
					use("carla", "carlinha", at(12, 21, 4)),
					use("bruno.s", "bruno", at(12, 21, 5)),
				],
			}),
			"u-kid",
			now,
		);
		expect(row).toMatchObject({
			kind: "group",
			title: "Para o grupo",
			usage: "4 de 8 entraram",
			who: "lua, pedrin, carlinha e bruno",
			percent: 50,
			note: "Durou 5 minutos",
			pending: false,
		});
	});

	it("usado, revogado e do seu jeito", () => {
		expect(
			inviteRow(
				invite({
					status: "exhausted",
					uses: [use("thiago", "thi", at(8, 20, 50))],
				}),
				"u-kid",
				now,
			),
		).toMatchObject({ usage: "thi entrou", percent: 100, note: "Em 8 out" });
		expect(
			inviteRow(
				invite({ status: "revoked", revoked_at: at(4, 9, 0) }),
				"u-kid",
				now,
			),
		).toMatchObject({
			usage: "Ninguém entrou",
			note: "Em 4 out",
		});
		expect(
			inviteRow(invite({ preset: "custom", max_uses: 3 }), "u-kid", now).title,
		).toBe("Para 3 pessoas");
	});

	it("a recuperação diz de quem é a conta", () => {
		const row = inviteRow(
			invite({
				kind: "recovery",
				preset: null,
				target: { id: "u-carla", nick: "carla", display_name: "carlinha" },
				created_at: at(16, 18, 40),
			}),
			"u-kid",
			now,
		);
		expect(row).toMatchObject({
			kind: "recovery",
			title: "Recuperação de carlinha",
			subtitle: "Trocar de computador · criado ontem, 18:40",
			usage: "Ainda não foi usado",
		});
	});

	it('junta os nomes com vírgula e "e"', () => {
		expect(joinNames(["lua"])).toBe("lua");
		expect(joinNames(["lua", "pedrin"])).toBe("lua e pedrin");
		expect(joinNames(["lua", "pedrin", "bruno"])).toBe("lua, pedrin e bruno");
	});
});

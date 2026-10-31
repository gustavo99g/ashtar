import { describe, expect, it } from "vitest";
import type { MemberView } from "@/lib/api";
import { joinNotices, noticeText } from "../model/joinNotices";
import { member, NOW, owner } from "./testMembers";

const group = (uses: number) => ({
	invite_id: "g1",
	preset: "group" as const,
	uses,
	max_uses: 8,
});
const marcao = member("marcao", { display_name: "marcão" });
const base: MemberView[] = [owner, marcao];

describe("aviso de quem entrou", () => {
	it("sem mudança, sem aviso", () => {
		expect(joinNotices(base, base)).toEqual([]);
	});

	it('membro novo vira "entrou no grupo" com quantos já usaram o convite', () => {
		const lua = member("luana", { display_name: "lua", joined_with: group(3) });
		const [notice] = joinNotices(base, [...base, lua]);

		expect(notice).toMatchObject({
			kind: "joined",
			people: [lua],
			preset: "group",
			uses: 3,
			maxUses: 8,
		});
		expect(noticeText(notice)).toEqual({
			names: ["lua"],
			title: "entrou no grupo",
			description: "Com o seu convite para o grupo · 3 de 8",
		});
	});

	it("quem entra com o mesmo convite na mesma consulta vira um aviso só", () => {
		const lua = member("luana", { display_name: "lua", joined_with: group(5) });
		const pedrin = member("pedro.h", {
			display_name: "pedrin",
			joined_with: group(5),
		});
		const thi = member("thiago", { display_name: "thi" });

		const notices = joinNotices(base, [...base, lua, pedrin, thi]);

		expect(notices).toHaveLength(2);
		expect(noticeText(notices[0])).toEqual({
			names: ["lua", "pedrin"],
			title: "entraram no grupo",
			description: "Com o seu convite para o grupo · 5 de 8",
		});
		expect(noticeText(notices[1]).description).toBe(
			"Com o seu convite para uma pessoa",
		);
	});

	it('quem tinha recuperação pendente e ganhou computador novo "voltou"', () => {
		const before = member("carla", {
			display_name: "carlinha",
			device: null,
			pending_recovery: { invite_id: "r1", expires_at: NOW + 86_400 },
		});
		const after = {
			...before,
			device: { linked_at: NOW },
			pending_recovery: null,
		};

		const [notice] = joinNotices([owner, before], [owner, after]);

		expect(notice).toEqual({ kind: "recovered", person: after });
		expect(noticeText(notice)).toEqual({
			names: ["carlinha"],
			title: "voltou",
			description: "Vinculou um computador novo com o convite de recuperação",
		});
	});

	it("não avisa de quem já chega removido nem de computador novo sem recuperação", () => {
		const removed = member("bruno", { removed_at: NOW });
		const relinked = { ...marcao, device: { linked_at: NOW } };

		expect(joinNotices(base, [owner, relinked, removed])).toEqual([]);
	});

	it("o do seu jeito diz quantos já entraram", () => {
		const rafa = member("rafa.gomes", {
			display_name: "rafa",
			joined_with: { invite_id: "c1", preset: "custom", uses: 2, max_uses: 4 },
		});
		const [notice] = joinNotices(base, [...base, rafa]);

		expect(noticeText(notice).description).toBe(
			"Com o seu convite do seu jeito · 2 de 4",
		);
	});
});

import { describe, expect, it } from "vitest";
import type { Session } from "@/features/identity";
import { ApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { entryDestination, invitePath } from "../destination";
import type { InviteLink } from "../inviteLink";

const connected: Session = {
	status: "connected",
	user: { id: "u1", nick: "kid", display_name: null, is_owner: false },
};
const noAccount: Session = { status: "noAccount" };
const leftGroup: Session = {
	status: "leftGroup",
	account: { nick: "juju", display_name: null },
};
const newInvite: InviteLink = { kind: "new", code: "7KQ2-M9XD-4HPA" };
const recovery: InviteLink = { kind: "recovery", code: "3RTW-8NB5-QZ6C" };
const codeOnly: InviteLink = { kind: "unknown", code: "7KQ2-M9XD-4HPA" };

describe("entryDestination", () => {
	it("sem link, cada sessão vai para a sua tela", () => {
		expect(entryDestination(connected, null)).toBe(paths.server);
		expect(entryDestination(noAccount, null)).toBe(paths.entry.noInvite);
		expect(entryDestination(leftGroup, null)).toBe(paths.entry.leftGroup);
	});

	it("com conta, o link não é usado", () => {
		expect(entryDestination(connected, newInvite)).toBe(paths.entry.alreadyIn);
		expect(entryDestination(connected, recovery)).toBe(paths.entry.alreadyIn);
	});

	it("sem conta, ou fora do grupo, o link vai para o convite", () => {
		expect(entryDestination(noAccount, newInvite)).toBe(
			paths.entry.invite("7KQ2-M9XD-4HPA"),
		);
		expect(entryDestination(noAccount, recovery)).toBe(
			paths.entry.recovery("3RTW-8NB5-QZ6C"),
		);
		expect(entryDestination(leftGroup, recovery)).toBe(
			paths.entry.recovery("3RTW-8NB5-QZ6C"),
		);
		expect(entryDestination(leftGroup, newInvite)).toBe(
			paths.entry.invite("7KQ2-M9XD-4HPA"),
		);
	});

	it("entrando, ou com erro, fica onde está", () => {
		const error: Session = {
			status: "error",
			error: new ApiError({ status: 0, kind: "network", message: "Sem rede." }),
		};
		expect(entryDestination({ status: "entering" }, newInvite)).toBeNull();
		expect(entryDestination(error, null)).toBeNull();
	});
});

describe("invitePath", () => {
	it("o código sozinho começa pela tela do nick", () => {
		expect(invitePath(codeOnly)).toBe(paths.entry.invite("7KQ2-M9XD-4HPA"));
	});
});

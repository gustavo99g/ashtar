import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@/lib/api";
import { membersKeys } from "../queries";
import { handleMembersRealtime } from "../realtime";

const ready: ServerEvent = {
	type: "ready",
	call: null,
	user_id: "u1",
	online: [],
	busy: [], away: [],
	status: "available",
	channels: [],
	dms: [],
};

/** Um cache com a lista do Painel e se ela ficou velha depois do evento. */
function invalidatedBy(event: ServerEvent, resumed = false): boolean {
	const client = new QueryClient();
	client.setQueryData(membersKeys.list(), []);
	handleMembersRealtime(event, client, { resumed });
	return client.getQueryState(membersKeys.list())?.isInvalidated === true;
}

describe("handleMembersRealtime", () => {
	it("quem entrou ou saiu do grupo marca a lista do Painel como velha", () => {
		const person = {
			id: "u2",
			nick: "ana",
			display_name: null,
			is_owner: false,
			online: false,
			status: "available" as const,
		};
		expect(invalidatedBy({ type: "member.joined", person })).toBe(true);
		expect(invalidatedBy({ type: "member.left", user_id: "u2" })).toBe(true);
	});

	it("o ready só marca na volta de uma queda", () => {
		expect(invalidatedBy(ready, false)).toBe(false);
		expect(invalidatedBy(ready, true)).toBe(true);
	});

	it("os outros eventos não mexem na lista", () => {
		expect(
			invalidatedBy({
				type: "presence.changed",
				user_id: "u2",
				online: true,
				status: "available",
			}),
		).toBe(false);
	});
});

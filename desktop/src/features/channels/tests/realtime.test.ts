import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Layout, ServerEvent } from "@/lib/api";
import { channelsKeys } from "../queries";
import { handleChannelsRealtime } from "../realtime";

const layout: Layout = { version: 5, top: [], categories: [] };

const ready: ServerEvent = {
	type: "ready",
	user_id: "u1",
	online: [],
	busy: [],
	status: "available",
	channels: [],
	dms: [],
};

/** Se a lista em cache ficou velha depois do evento. */
function invalidatedBy(event: ServerEvent, resumed = false): boolean {
	const client = new QueryClient();
	client.setQueryData(channelsKeys.layout(), layout);
	handleChannelsRealtime(event, client, { resumed });
	return client.getQueryState(channelsKeys.layout())?.isInvalidated === true;
}

describe("handleChannelsRealtime", () => {
	it("channels.changed só recarrega com uma versão mais nova que a do cache", () => {
		expect(invalidatedBy({ type: "channels.changed", version: 4 })).toBe(false);
		expect(invalidatedBy({ type: "channels.changed", version: 5 })).toBe(false);
		expect(invalidatedBy({ type: "channels.changed", version: 6 })).toBe(true);
	});

	it("o ready só recarrega na volta de uma queda", () => {
		expect(invalidatedBy(ready, false)).toBe(false);
		expect(invalidatedBy(ready, true)).toBe(true);
	});

	it("sem a lista no cache, não quebra", () => {
		const client = new QueryClient();
		handleChannelsRealtime({ type: "channels.changed", version: 1 }, client, {
			resumed: false,
		});
		expect(client.getQueryData(channelsKeys.layout())).toBeUndefined();
	});
});

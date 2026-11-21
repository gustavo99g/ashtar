import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ParticipantView, ServerEvent } from "@/lib/api";
import { voiceKeys } from "../queries";
import { handleVoiceRealtime } from "../realtime";

const kid: ParticipantView = {
	user_id: "u1",
	nick: "kid",
	display_name: null,
	screen_sharing: true,
	mic_off: false,
	deafened: false,
	camera: false,
};

describe("handleVoiceRealtime", () => {
	it("voice.participants troca a lista da sala no cache", () => {
		const client = new QueryClient();
		client.setQueryData(voiceKeys.participants("sala"), []);
		handleVoiceRealtime(
			{ type: "voice.participants", channel_id: "sala", participants: [kid] },
			client,
			{ resumed: false },
		);
		expect(client.getQueryData(voiceKeys.participants("sala"))).toEqual([kid]);
	});

	it("o ready da volta de uma queda marca a lista como velha; o primeiro, não", () => {
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
		const client = new QueryClient();
		client.setQueryData(voiceKeys.participants("sala"), [kid]);
		const invalidated = () =>
			client.getQueryState(voiceKeys.participants("sala"))?.isInvalidated;

		handleVoiceRealtime(ready, client, { resumed: false });
		expect(invalidated()).toBe(false);
		handleVoiceRealtime(ready, client, { resumed: true });
		expect(invalidated()).toBe(true);
	});
});

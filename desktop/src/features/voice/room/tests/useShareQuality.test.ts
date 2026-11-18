import { EventEmitter } from "node:events";
import { act, renderHook } from "@testing-library/react";
import { type Room, RoomEvent } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { encodeShareQuality, QUALITY_TOPIC } from "@/features/screen-share";
import {
	useAnnounceShareQuality,
	useShareQuality,
} from "../hooks/useShareQuality";

function fakeRoom() {
	const events = new EventEmitter();
	const publishData = vi.fn(() => Promise.resolve());
	const room = Object.assign(events, {
		localParticipant: { publishData },
	}) as unknown as Room;
	const receive = (from: string, payload: Uint8Array, topic = QUALITY_TOPIC) =>
		act(() => {
			events.emit(
				RoomEvent.DataReceived,
				payload,
				{ identity: from },
				undefined,
				topic,
			);
		});
	return { room, publishData, receive };
}

describe("qualidade da transmissão para quem assiste", () => {
	it("quem assiste fica com o aviso do dono, e uma transmissão nova recomeça", () => {
		const { room, receive } = fakeRoom();
		const { result, rerender } = renderHook(
			({ name }) => useShareQuality(room, "u1", name),
			{ initialProps: { name: "a" } },
		);
		expect(result.current).toBeNull();

		// Outro participante, ou outro tópico, não vale.
		receive("u2", encodeShareQuality("720p60"));
		receive("u1", encodeShareQuality("720p60"), "screen-viewers");
		expect(result.current).toBeNull();

		receive("u1", encodeShareQuality("720p60"));
		expect(result.current).toBe("720p60");

		rerender({ name: "b" });
		expect(result.current).toBeNull();
	});

	it("quem transmite avisa ao trocar e quando alguém começa a assistir", () => {
		const { room, publishData } = fakeRoom();
		const none: ReadonlyMap<string, number> = new Map();
		const { rerender } = renderHook(
			({ quality, viewers }) => useAnnounceShareQuality(room, quality, viewers),
			{
				initialProps: {
					quality: "1080p60" as "1080p60" | "720p60" | null,
					viewers: none,
				},
			},
		);
		expect(publishData).toHaveBeenCalledTimes(1);

		rerender({ quality: "720p60", viewers: none });
		expect(publishData).toHaveBeenCalledTimes(2);
		expect(publishData).toHaveBeenLastCalledWith(encodeShareQuality("720p60"), {
			reliable: true,
			topic: QUALITY_TOPIC,
		});

		// A mesma lista com outra hora não avisa de novo; alguém novo, sim.
		const one = new Map([["u2", 1]]);
		rerender({ quality: "720p60", viewers: one });
		rerender({ quality: "720p60", viewers: new Map([["u2", 2]]) });
		expect(publishData).toHaveBeenCalledTimes(3);

		// Sem transmissão, nada.
		rerender({ quality: null, viewers: one });
		expect(publishData).toHaveBeenCalledTimes(3);
	});
});

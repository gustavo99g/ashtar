import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sound } from "@/lib/api";
import { onSoundPlayed } from "../model/played";
import { handleSoundsRealtime } from "../realtime";
import {
	DEFAULT_SOUNDBOARD,
	readSoundboard,
	setSlot,
	useSoundboard,
} from "../stores/soundboardPrefs";
import { markPlaying, useSoundsStore } from "../stores/soundsStore";

const sound = (id: string, name = id): Sound => ({
	id,
	name,
	emoji: null,
	file_id: `arq-${id}`,
	duration_ms: 800,
	uploaded_by: "kid",
	uploader_name: "Kid",
	status: "approved",
	reason: null,
	created_at: 0,
	reviewed_at: 0,
});

const info = { resumed: false };

describe("as preferências do soundboard", () => {
	beforeEach(() => useSoundboard.setState(DEFAULT_SOUNDBOARD));

	it("lê do disco e troca o estranho pelo padrão", () => {
		expect(readSoundboard(null)).toEqual(DEFAULT_SOUNDBOARD);
		expect(
			readSoundboard({ enabled: false, volume: 250, slots: ["a", 3, "", "d", "e"] }),
		).toEqual({ enabled: false, volume: 100, slots: ["a", null, null, "d"] });
	});

	it("um som ocupa um lugar só", () => {
		setSlot(0, "buzina");
		setSlot(2, "buzina");
		expect(useSoundboard.getState().slots).toEqual([null, null, "buzina", null]);
		setSlot(2, null);
		setSlot(9, "fora");
		expect(useSoundboard.getState().slots).toEqual([null, null, null, null]);
	});
});

describe("o tempo real dos sons", () => {
	afterEach(() => vi.useRealTimers());

	it("sounds.changed troca a lista e sounds.queue o contador", () => {
		const client = new QueryClient();
		handleSoundsRealtime(
			{ type: "sounds.changed", sounds: [sound("buzina")] },
			client,
			info,
		);
		handleSoundsRealtime({ type: "sounds.queue", pending: 2 }, client, info);
		const state = useSoundsStore.getState();
		expect(state.sounds.map((item) => item.id)).toEqual(["buzina"]);
		expect(state.pending).toBe(2);
		expect(client.getQueryData(["sounds", "approved"])).toHaveLength(1);
	});

	it("voice.sound_played vai para o tocador", () => {
		const heard = vi.fn();
		const off = onSoundPlayed(heard);
		handleSoundsRealtime(
			{
				type: "voice.sound_played",
				sound_id: "buzina",
				file_id: "arq-buzina",
				user_id: "juju",
				channel_id: "sala",
			},
			new QueryClient(),
			info,
		);
		off();
		expect(heard).toHaveBeenCalledWith({
			soundId: "buzina",
			fileId: "arq-buzina",
			userId: "juju",
			channelId: "sala",
		});
	});

	it("a onda dura o som e some sozinha", () => {
		vi.useFakeTimers();
		markPlaying("juju", 2000, Date.now());
		expect(useSoundsStore.getState().playing.juju).toBeDefined();
		vi.advanceTimersByTime(1999);
		expect(useSoundsStore.getState().playing.juju).toBeDefined();
		vi.advanceTimersByTime(1);
		expect(useSoundsStore.getState().playing.juju).toBeUndefined();
	});
});

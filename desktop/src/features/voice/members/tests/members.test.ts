import { describe, expect, it } from "vitest";
import {
	type ChannelMember,
	memberFromApi,
	peopleNowLabel,
	sharingFirst,
} from "../model/members";

describe("memberFromApi", () => {
	it("usa o nome visível (sem ele, o nick) e o estado que o app contou", () => {
		expect(
			memberFromApi({
				user_id: "u1",
				nick: "juliana",
				display_name: "juju",
				screen_sharing: true,
				mic_off: true,
				deafened: false,
				camera: true,
				server_muted: false,
				server_deafened: false,
			}),
		).toEqual({
			id: "u1",
			nick: "juliana",
			name: "juju",
			sharing: true,
			micOff: true,
			deafened: false,
			serverMuted: false,
			serverDeafened: false,
			camera: true,
		});
		expect(
			memberFromApi({
				user_id: "u2",
				nick: "rafa",
				display_name: null,
				screen_sharing: false,
				mic_off: false,
				deafened: false,
				camera: false,
				server_muted: false,
				server_deafened: false,
			}),
		).toEqual({
			id: "u2",
			nick: "rafa",
			name: "rafa",
			sharing: false,
			micOff: false,
			deafened: false,
			serverMuted: false,
			serverDeafened: false,
			camera: false,
		});
	});
});

describe("peopleNowLabel", () => {
	it("concorda no singular e no plural", () => {
		expect(peopleNowLabel(1, "Sala")).toBe("1 pessoa na Sala agora");
		expect(peopleNowLabel(4, "Sala")).toBe("4 pessoas na Sala agora");
	});
});

describe("sharingFirst", () => {
	const person = (id: string, startedAt?: number): ChannelMember => ({
		id,
		nick: id,
		name: id,
		sharing: startedAt !== undefined,
		share:
			startedAt === undefined || Number.isNaN(startedAt)
				? undefined
				: { title: "", window: false, quality: "1080p60", startedAt, viewers: 0 },
	});

	it("quem transmite vem primeiro, do mais recente ao mais antigo", () => {
		const list = [person("a"), person("b", 100), person("c"), person("d", 200)];
		expect(sharingFirst(list).map((m) => m.id)).toEqual(["d", "b", "a", "c"]);
	});

	it("quem acabou de começar, sem horário ainda, fica no topo", () => {
		const list = [person("a", 100), person("b", Number.NaN)];
		expect(sharingFirst(list).map((m) => m.id)).toEqual(["b", "a"]);
	});

	it("sem ninguém transmitindo, a ordem não muda", () => {
		const list = [person("c"), person("a"), person("b")];
		expect(sharingFirst(list).map((m) => m.id)).toEqual(["c", "a", "b"]);
	});
});

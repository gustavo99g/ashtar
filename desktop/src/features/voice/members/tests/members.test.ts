import { describe, expect, it } from "vitest";
import {
	type ChannelMember,
	memberFromApi,
	membersFromApi,
	peopleNowLabel,
	sharingFirst,
} from "../model/members";

describe("membersFromApi", () => {
	it("cada aparelho vira uma entrada à parte, logo depois do dono, que não fica transmitindo", () => {
		const person = (id: string, devices: { identity: string; name: string }[] = []) => ({
			user_id: id,
			nick: id,
			display_name: id === "u1" ? "Kid" : null,
			screen_sharing: false,
			mic_off: false,
			deafened: false,
			camera: false,
			server_muted: false,
			server_deafened: false,
			sounds_blocked: false,
			devices,
		});
		const members = membersFromApi([
			person("u1", [{ identity: "u1:screen-ab12", name: "Odin 3" }]),
			person("u2"),
		]);
		expect(members.map((m) => [m.id, m.name, m.sharing])).toEqual([
			["u1", "Kid", false],
			["u1:screen-ab12", "Odin 3", true],
			["u2", "u2", false],
		]);
		expect(members[1]?.device).toEqual({ ownerId: "u1", ownerName: "Kid" });
	});
});

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
				sounds_blocked: false,
				devices: [],
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
			soundsBlocked: false,
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
				sounds_blocked: false,
				devices: [],
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
			soundsBlocked: false,
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

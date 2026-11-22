import { describe, expect, it } from "vitest";
import { memberFromApi, peopleNowLabel } from "../model/members";

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

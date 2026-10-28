import { describe, expect, it } from "vitest";
import { memberFromApi, peopleNowLabel } from "../members";

describe("memberFromApi", () => {
	it("usa o nome visível e, sem ele, o nick", () => {
		expect(
			memberFromApi({
				user_id: "u1",
				nick: "juliana",
				display_name: "juju",
				screen_sharing: true,
			}),
		).toEqual({ id: "u1", nick: "juliana", name: "juju", sharing: true });
		expect(
			memberFromApi({
				user_id: "u2",
				nick: "rafa",
				display_name: null,
				screen_sharing: false,
			}),
		).toEqual({ id: "u2", nick: "rafa", name: "rafa", sharing: false });
	});
});

describe("peopleNowLabel", () => {
	it("concorda no singular e no plural", () => {
		expect(peopleNowLabel(1, "Sala")).toBe("1 pessoa na Sala agora");
		expect(peopleNowLabel(4, "Sala")).toBe("4 pessoas na Sala agora");
	});
});

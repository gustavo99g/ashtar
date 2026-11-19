import { describe, expect, it } from "vitest";
import {
	joinNames,
	RESTART_GRACE_MS,
	startedShares,
} from "../model/shareStarts";

describe("transmissões que começaram", () => {
	it("ao entrar, nada: o que já estava no ar não é novidade", () => {
		expect(startedShares(null, ["juju"], new Map(), 0)).toEqual([]);
	});

	it("as que não estavam antes", () => {
		expect(
			startedShares(new Set(["juju"]), ["juju", "marcao", "rafa"], new Map(), 0),
		).toEqual(["marcao", "rafa"]);
	});

	it("quem parou e voltou logo não conta; depois de um tempo, conta", () => {
		const ended = new Map([["juju", 1_000]]);
		expect(startedShares(new Set(), ["juju"], ended, 5_000)).toEqual([]);
		expect(
			startedShares(new Set(), ["juju"], ended, 1_000 + RESTART_GRACE_MS + 1),
		).toEqual(["juju"]);
	});

	it("junta os nomes", () => {
		expect(joinNames(["Juju"])).toBe("Juju");
		expect(joinNames(["Juju", "Marcão"])).toBe("Juju e Marcão");
		expect(joinNames(["Juju", "Marcão", "Rafa"])).toBe("Juju, Marcão e Rafa");
	});
});

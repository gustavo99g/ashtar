import { describe, expect, it } from "vitest";
import {
	parseShareTrackName,
	shareSpec,
	shareTrackName,
	shareWinner,
} from "../shareInfo";

const name = (startedAt: number) =>
	shareTrackName({ startedAt, quality: "720p60", title: "Jogo" });

describe("nome da trilha", () => {
	it("volta igual do outro lado", () => {
		const info = {
			startedAt: 1_700_000_000_123,
			quality: "1080p30" as const,
			title: "Paleta do Ashtar",
		};
		expect(parseShareTrackName(shareTrackName(info))).toEqual(info);
	});

	it("corta um título comprido", () => {
		const parsed = parseShareTrackName(
			shareTrackName({
				startedAt: 1,
				quality: "720p60",
				title: "x".repeat(300),
			}),
		);
		expect(parsed?.title).toHaveLength(80);
	});

	it.each([
		["o nome antigo", "screen-share"],
		["sem nome", undefined],
		["JSON quebrado", "screen-share:{"],
		["qualidade desconhecida", 'screen-share:{"t":1,"q":"4k","s":"x"}'],
		["sem horário", 'screen-share:{"q":"720p60","s":"x"}'],
	])("%s não tem informação", (_, trackName) => {
		expect(parseShareTrackName(trackName)).toBeNull();
	});

	it("shareSpec diz a qualidade com o fps", () => {
		expect(shareSpec({ startedAt: 1, quality: "1080p30", title: "x" })).toBe(
			"1080p · 30 fps",
		);
	});
});

describe("shareWinner", () => {
	it("continua quem começou antes", () => {
		const juju = { identity: "u-juju", trackName: name(1000) };
		const kid = { identity: "u-kid", trackName: name(1001) };
		expect(shareWinner([juju, kid])).toBe(juju);
		expect(shareWinner([kid, juju])).toBe(juju);
	});

	it("no empate, a menor identidade, nos dois lados", () => {
		const a = { identity: "a", trackName: name(1000) };
		const b = { identity: "b", trackName: name(1000) };
		expect(shareWinner([a, b])).toBe(a);
		expect(shareWinner([b, a])).toBe(a);
	});

	it("sem horário conta como a mais antiga", () => {
		const old = { identity: "z", trackName: "screen-share" };
		const kid = { identity: "a", trackName: name(1) };
		expect(shareWinner([kid, old])).toBe(old);
	});

	it("com uma só, ela; sem nenhuma, nada", () => {
		const kid = { identity: "u-kid", trackName: name(5) };
		expect(shareWinner([kid])).toBe(kid);
		expect(shareWinner([])).toBeUndefined();
	});
});

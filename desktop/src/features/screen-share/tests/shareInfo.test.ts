import { describe, expect, it } from "vitest";
import {
	compareShares,
	decodeShareQuality,
	encodeShareQuality,
	isDeviceShareKey,
	isScreenIdentity,
	parseShareTrackName,
	screenIdentityOf,
	shareKey,
	shareOwner,
	sharerLabel,
	shareSource,
	shareSpec,
	shareTrackName,
} from "../model/shareInfo";

const name = (startedAt: number) =>
	shareTrackName({ startedAt, quality: "1080p60", title: "Jogo" });

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
				quality: "1080p60",
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
		["sem horário", 'screen-share:{"q":"1080p60","s":"x"}'],
	])("%s não tem informação", (_, trackName) => {
		expect(parseShareTrackName(trackName)).toBeNull();
	});

	it("shareSpec diz a qualidade com o fps", () => {
		expect(shareSpec({ startedAt: 1, quality: "1080p30", title: "x" })).toBe(
			"1080p · 30 fps",
		);
	});
});

describe("compareShares", () => {
	const sorted = (list: { identity: string; trackName: string }[]) =>
		[...list].sort(compareShares).map((share) => share.identity);

	it("a que começou antes vem primeiro", () => {
		const juju = { identity: "u-juju", trackName: name(1000) };
		const kid = { identity: "u-kid", trackName: name(1001) };
		expect(sorted([kid, juju])).toEqual(["u-juju", "u-kid"]);
		expect(sorted([juju, kid])).toEqual(["u-juju", "u-kid"]);
	});

	it("no empate, a menor identidade, nos dois lados", () => {
		const a = { identity: "a", trackName: name(1000) };
		const b = { identity: "b", trackName: name(1000) };
		expect(sorted([b, a])).toEqual(["a", "b"]);
	});

	it("sem horário conta como a mais antiga", () => {
		const old = { identity: "z", trackName: "screen-share" };
		const kid = { identity: "a", trackName: name(1) };
		expect(sorted([kid, old])).toEqual(["z", "a"]);
	});
});

describe("aviso da qualidade", () => {
	it("vai e volta pelo tópico, e só aceita um preset conhecido", () => {
		expect(decodeShareQuality(encodeShareQuality("720p60"))).toBe("720p60");
		const raw = (text: string) => new TextEncoder().encode(text);
		expect(decodeShareQuality(raw('{"quality":"4k"}'))).toBeNull();
		expect(decodeShareQuality(raw('{"quality":3}'))).toBeNull();
		expect(decodeShareQuality(raw("lixo"))).toBeNull();
	});
});

describe("tela do computador e de um aparelho (ADR 0038)", () => {
	it("reconhece as duas e acha o dono", () => {
		expect(isScreenIdentity("kid:screen")).toBe(true);
		expect(isScreenIdentity("kid:screen-0a1b2c")).toBe(true);
		expect(isScreenIdentity("kid")).toBe(false);
		expect(isScreenIdentity("kid:screen-")).toBe(false);
		expect(isScreenIdentity(":screen")).toBe(false);
		expect(shareOwner("kid:screen-0a1b2c")).toBe("kid");
		expect(shareOwner("kid:screen")).toBe("kid");
		expect(shareOwner("kid")).toBe("kid");
	});

	it("a chave do computador é o dono, a do aparelho é a identidade", () => {
		expect(shareKey("kid:screen")).toBe("kid");
		expect(shareKey("kid:screen-odin")).toBe("kid:screen-odin");
		expect(shareKey("kid")).toBe("kid");
		expect(isDeviceShareKey("kid:screen-odin")).toBe(true);
		expect(isDeviceShareKey("kid")).toBe(false);
		expect(screenIdentityOf("kid")).toBe("kid:screen");
		expect(screenIdentityOf("kid:screen-odin")).toBe("kid:screen-odin");
	});

	it("lê o nome do aparelho dos metadados", () => {
		expect(
			shareSource('{"screenOf":"kid","nick":"kid","source":"Odin 3"}'),
		).toBe("Odin 3");
		expect(shareSource('{"screenOf":"kid","nick":"kid"}')).toBeNull();
		expect(shareSource("nada")).toBeNull();
		expect(shareSource(undefined)).toBeNull();
		expect(sharerLabel("Kid", "Odin 3")).toBe("Kid · Odin 3");
		expect(sharerLabel("Kid", null)).toBe("Kid");
	});
});

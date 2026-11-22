import { describe, expect, it } from "vitest";
import { type DeviceStatus, deviceNotices } from "../model/deviceNotices";

function status(
	patch: Partial<DeviceStatus["missing"]> = {},
	inputs: number | null = 2,
): DeviceStatus {
	return { missing: { input: false, output: false, ...patch }, inputs };
}

describe("os avisos dos dispositivos", () => {
	it("avisa quando o escolhido some, e quando volta", () => {
		expect(deviceNotices(status(), status({ input: true }))).toEqual([
			{ kind: "missing", device: "input" },
		]);
		expect(deviceNotices(status({ output: true }), status())).toEqual([
			{ kind: "back", device: "output" },
		]);
		expect(deviceNotices(status({ input: true }), status({ input: true }))).toEqual(
			[],
		);
	});

	it("o primeiro microfone que aparece oferece ativar", () => {
		expect(deviceNotices(status({}, 0), status({}, 1))).toEqual([
			{ kind: "microphoneFound" },
		]);
		// Uma lista que não servia (sem a permissão) não conta como "nenhum".
		expect(deviceNotices(status({}, null), status({}, 1))).toEqual([]);
	});
});

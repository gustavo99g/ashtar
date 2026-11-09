import { describe, expect, it } from "vitest";
import type { ShareStats } from "@/lib/tauri/commands";
import {
	formatElapsed,
	HISTORY_SECONDS,
	pushStats,
	shareHealth,
	watchingFor,
} from "../health";

function stats(over: Partial<ShareStats> = {}): ShareStats {
	return {
		sessionId: 1,
		encoder: { kind: "hardware", name: "x" },
		adapter: "x",
		width: 1920,
		height: 1080,
		fps: 60,
		bitrateKbps: 8_000,
		targetKbps: 8_000,
		latencyMs: 6,
		keyframes: 1,
		dropped: 0,
		paused: false,
		...over,
	};
}

describe("saúde da transmissão", () => {
	it("pausada vem antes de tudo; depois quadros perdidos; depois a rede", () => {
		expect(shareHealth([], "1080p60")).toBe("ok");
		expect(
			shareHealth([stats({ paused: true, targetKbps: 1 })], "1080p60"),
		).toBe("paused");
		expect(
			shareHealth(
				[stats(), stats({ dropped: 2, targetKbps: 1_000 })],
				"1080p60",
			),
		).toBe("computer");
		expect(shareHealth([stats({ targetKbps: 1_000 })], "1080p60")).toBe(
			"network",
		);
	});

	it("o fps baixo da tela parada não é problema, e perdidos antigos não contam", () => {
		expect(shareHealth([stats({ fps: 1 })], "1080p60")).toBe("ok");
		const old = [
			stats({ dropped: 0 }),
			stats({ dropped: 4 }),
			...Array.from({ length: 6 }, () => stats({ dropped: 4 })),
		];
		expect(shareHealth(old, "1080p60")).toBe("ok");
	});

	it("o histórico guarda um minuto e recomeça numa sessão nova", () => {
		let history: readonly ShareStats[] = [];
		for (let i = 0; i < HISTORY_SECONDS + 5; i++) {
			history = pushStats(history, stats());
		}
		expect(history).toHaveLength(HISTORY_SECONDS);
		expect(pushStats(history, stats({ sessionId: 2 }))).toHaveLength(1);
	});

	it("os relógios", () => {
		expect(formatElapsed(0, 65_000)).toBe("1:05");
		expect(formatElapsed(0, 3_723_000)).toBe("1:02:03");
		expect(watchingFor(0, 30_000)).toBe("agora");
		expect(watchingFor(0, 12 * 60_000)).toBe("há 12 min");
		expect(watchingFor(0, 2 * 3_600_000)).toBe("há 2 h");
	});
});

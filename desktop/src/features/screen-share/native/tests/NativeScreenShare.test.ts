import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScreenToken } from "@/lib/api";
import {
	type CaptureSource,
	onScreenShareAudioEnded,
	onScreenShareEnded,
	onScreenShareLinkLost,
	onScreenShareStats,
	type ScreenShareEnded,
	type ScreenShareLinkLost,
	type ShareStats,
	screenShareReconnect,
	screenShareStart,
	screenShareStop,
	screenShareUpdate,
} from "@/lib/tauri/commands";
import type { ShareRequest } from "../../model/controller";
import {
	NativeScreenShare,
	RETRY_DELAYS_MS,
} from "../../native/NativeScreenShare";

vi.mock("@/lib/api", () => ({ createScreenToken: vi.fn() }));
vi.mock("@/lib/tauri/commands", () => ({
	isAppError: (value: unknown) =>
		typeof value === "object" && value !== null && "kind" in value,
	listCaptureSources: vi.fn(),
	onScreenShareEnded: vi.fn(),
	onScreenShareAudioEnded: vi.fn(),
	onScreenShareStats: vi.fn(),
	onScreenShareLinkLost: vi.fn(),
	screenShareReconnect: vi.fn(),
	screenShareStart: vi.fn(),
	screenShareUpdate: vi.fn(),
	screenShareStop: vi.fn(),
}));

const source: CaptureSource = {
	source: { kind: "window", id: 5 },
	title: "Jogo",
	processId: 9,
	icon: null,
	monitor: null,
	minimized: false,
};
const request: ShareRequest = {
	source,
	quality: "1080p30",
	audio: { mode: "application", processId: 9 },
	cursor: true,
};

/** Os eventos do Rust, para o teste disparar. */
const rust: {
	ended?: (event: ScreenShareEnded) => void;
	audioEnded?: (event: ScreenShareEnded) => void;
	stats?: (stats: ShareStats) => void;
	linkLost?: (event: ScreenShareLinkLost) => void;
	unlistened: number;
} = { unlistened: 0 };

beforeEach(() => {
	vi.clearAllMocks();
	rust.unlistened = 0;
	const unlisten = () => {
		rust.unlistened += 1;
	};
	vi.mocked(onScreenShareEnded).mockImplementation(async (callback) => {
		rust.ended = callback;
		return unlisten;
	});
	vi.mocked(onScreenShareAudioEnded).mockImplementation(async (callback) => {
		rust.audioEnded = callback;
		return unlisten;
	});
	vi.mocked(onScreenShareStats).mockImplementation(async (callback) => {
		rust.stats = callback;
		return unlisten;
	});
	vi.mocked(onScreenShareLinkLost).mockImplementation(async (callback) => {
		rust.linkLost = callback;
		return unlisten;
	});
	vi.mocked(screenShareReconnect).mockResolvedValue();
	vi.mocked(createScreenToken).mockResolvedValue({
		url: "wss://sala",
		token: "tk",
	});
	vi.mocked(screenShareStart).mockResolvedValue(7);
	vi.mocked(screenShareUpdate).mockResolvedValue();
	vi.mocked(screenShareStop).mockResolvedValue();
});

function stats(sessionId: number): ShareStats {
	return {
		sessionId,
		encoder: { kind: "hardware", name: "AMDh264Encoder" },
		adapter: "AMD",
		width: 1920,
		height: 1080,
		fps: 30,
		bitrateKbps: 7_000,
		targetKbps: 8_000,
		latencyMs: 5,
		keyframes: 1,
		dropped: 0,
		paused: false,
	};
}

describe("NativeScreenShare", () => {
	it("pede o token da tela da sala e começa no Rust com o nome da trilha", async () => {
		const share = new NativeScreenShare("jogatina");
		await share.start(request);

		expect(createScreenToken).toHaveBeenCalledWith("jogatina");
		const options = vi.mocked(screenShareStart).mock.calls[0][0];
		expect(options).toMatchObject({
			source: source.source,
			quality: "1080p30",
			audio: request.audio,
			cursor: true,
			target: { url: "wss://sala", token: "tk" },
		});
		expect(options.target.trackName).toMatch(/^screen-share:/);
		expect(share.getState()).toMatchObject({
			status: "active",
			sessionId: 7,
			audio: "on",
			paused: false,
		});
	});

	it("uma falha no começo vira o estado de erro, sem escutas sobrando", async () => {
		vi.mocked(createScreenToken).mockRejectedValue({
			kind: "Conflict",
			message: "Entre na sala de voz antes de transmitir.",
		});
		const share = new NativeScreenShare("jogatina");
		await share.start(request);

		expect(screenShareStart).not.toHaveBeenCalled();
		expect(share.getState()).toEqual({
			status: "error",
			kind: "Conflict",
			message: "Entre na sala de voz antes de transmitir.",
		});
		expect(rust.unlistened).toBe(4);
	});

	it("o fim que chega antes do id ainda encerra a sessão", async () => {
		vi.mocked(screenShareStart).mockImplementation(async () => {
			rust.ended?.({ sessionId: 7, reason: "sourceClosed", message: null });
			return 7;
		});
		const share = new NativeScreenShare("jogatina");
		await share.start(request);

		expect(share.getState()).toEqual({ status: "idle", ended: "sourceClosed" });
	});

	it("a conexão que cai vira erro, e só da própria sessão", async () => {
		const share = new NativeScreenShare("jogatina");
		await share.start(request);

		rust.ended?.({ sessionId: 6, reason: "error", message: "outra" });
		expect(share.getState().status).toBe("active");

		rust.ended?.({ sessionId: 7, reason: "error", message: "caiu" });
		expect(share.getState()).toEqual({
			status: "error",
			kind: "Publish",
			message: "caiu",
		});
	});

	it("o áudio que cai marca 'lost' e o vídeo continua", async () => {
		const share = new NativeScreenShare("jogatina");
		await share.start(request);

		rust.audioEnded?.({ sessionId: 7, reason: "error", message: "sumiu" });

		expect(share.getState()).toMatchObject({ status: "active", audio: "lost" });
	});

	it("os ajustes vão para o Rust e para o estado", async () => {
		const share = new NativeScreenShare("jogatina");
		await share.start(request);
		const other = { ...source, source: { kind: "monitor", id: 1 } as const };

		await share.update({ kind: "paused", paused: true });
		await share.update({ kind: "quality", quality: "1080p60" });
		await share.update({ kind: "source", source: other });
		await share.update({ kind: "audio", audio: { mode: "off" } });

		expect(vi.mocked(screenShareUpdate).mock.calls).toEqual([
			[7, { kind: "paused", paused: true }],
			[7, { kind: "quality", quality: "1080p60" }],
			[7, { kind: "source", source: other.source }],
			[7, { kind: "audio", audio: { mode: "off" } }],
		]);
		expect(share.getState()).toMatchObject({
			paused: true,
			quality: "1080p60",
			source: other,
			audio: "off",
		});
	});

	it("um ajuste que falha rejeita e não muda o estado", async () => {
		vi.mocked(screenShareUpdate).mockRejectedValue({
			kind: "AudioCapture",
			message: "não abriu",
		});
		const share = new NativeScreenShare("jogatina");
		await share.start(request);

		await expect(
			share.update({ kind: "audio", audio: { mode: "system" } }),
		).rejects.toMatchObject({ kind: "AudioCapture" });
		expect(share.getState()).toMatchObject({ audioMode: request.audio });
	});

	it("os números chegam só da própria sessão e somem ao parar", async () => {
		const share = new NativeScreenShare("jogatina");
		const seen: (ShareStats | null)[] = [];
		share.onStats((next) => seen.push(next));
		await share.start(request);

		rust.stats?.(stats(6));
		rust.stats?.(stats(7));
		expect(share.getStats()?.sessionId).toBe(7);

		await share.stop();

		expect(screenShareStop).toHaveBeenCalledWith(7);
		expect(share.getStats()).toBeNull();
		expect(seen.map((s) => s?.sessionId ?? null)).toEqual([7, null]);
		expect(share.getState()).toEqual({ status: "idle" });
	});

	it("parar durante o começo espera ele terminar", async () => {
		let resolve: (id: number) => void = () => {};
		vi.mocked(screenShareStart).mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		const share = new NativeScreenShare("jogatina");
		const starting = share.start(request);
		const stopping = share.stop();
		// O começo ainda não respondeu: ninguém parou nada.
		await Promise.resolve();
		expect(screenShareStop).not.toHaveBeenCalled();

		resolve(7);
		await starting;
		await stopping;

		expect(screenShareStop).toHaveBeenCalledWith(7);
		expect(share.getState()).toEqual({ status: "idle" });
	});

	it("um segundo começo é ignorado", async () => {
		const share = new NativeScreenShare("jogatina");
		await Promise.all([share.start(request), share.start(request)]);
		expect(screenShareStart).toHaveBeenCalledOnce();
	});

	describe("a conexão que cai", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		async function lost() {
			const share = new NativeScreenShare("jogatina");
			await share.start(request);
			const trackName =
				vi.mocked(screenShareStart).mock.calls[0][0].target.trackName;
			vi.mocked(createScreenToken).mockClear();
			rust.linkLost?.({ sessionId: 7 });
			return { share, trackName };
		}

		it("avisa, pede um token novo e volta com a mesma trilha", async () => {
			const { share, trackName } = await lost();
			expect(share.getState()).toMatchObject({ status: "active", link: "lost" });

			vi.mocked(createScreenToken).mockResolvedValueOnce({
				url: "wss://sala",
				token: "novo",
			});
			await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);

			expect(createScreenToken).toHaveBeenCalledWith("jogatina");
			expect(screenShareReconnect).toHaveBeenCalledWith(7, {
				url: "wss://sala",
				token: "novo",
				trackName,
			});
			expect(share.getState()).toMatchObject({ status: "active", link: "ok" });
		});

		it("falhando, tenta de novo esperando cada vez mais", async () => {
			const { share } = await lost();
			vi.mocked(createScreenToken).mockRejectedValueOnce(new Error("sem rede"));
			vi.mocked(screenShareReconnect).mockRejectedValueOnce({
				kind: "Publish",
				message: "ainda não",
			});

			await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
			expect(createScreenToken).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1] - 1);
			expect(createScreenToken).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(screenShareReconnect).toHaveBeenCalledTimes(1);
			expect(share.getState()).toMatchObject({ link: "lost" });

			await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[2]);
			expect(screenShareReconnect).toHaveBeenCalledTimes(2);
			expect(share.getState()).toMatchObject({ link: "ok" });
		});

		it("uma queda repetida no meio da volta não começa outra", async () => {
			await lost();
			rust.linkLost?.({ sessionId: 7 });
			rust.linkLost?.({ sessionId: 99 });

			await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
			expect(screenShareReconnect).toHaveBeenCalledTimes(1);
		});

		it("parar no meio cancela as tentativas", async () => {
			const { share } = await lost();
			await share.stop();

			await vi.advanceTimersByTimeAsync(60_000);
			expect(createScreenToken).not.toHaveBeenCalled();
			expect(screenShareReconnect).not.toHaveBeenCalled();
		});

		it("o Rust desistindo encerra como sempre", async () => {
			const { share } = await lost();
			vi.mocked(createScreenToken).mockRejectedValue(new Error("sem rede"));
			await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);

			rust.ended?.({
				sessionId: 7,
				reason: "error",
				message: "a conexão da transmissão caiu e não voltou",
			});
			await vi.advanceTimersByTimeAsync(60_000);

			expect(share.getState()).toMatchObject({ status: "error" });
			expect(createScreenToken).toHaveBeenCalledTimes(1);
		});
	});
});

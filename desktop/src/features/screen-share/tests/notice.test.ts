import { describe, expect, it } from "vitest";
import type { CaptureSource } from "@/lib/tauri/commands";
import type { ScreenShareState } from "../model/controller";
import { shareNotice } from "../model/notices";

const source: CaptureSource = {
	source: { kind: "window", id: 1 },
	title: "Navegador",
	processId: 7,
	icon: null,
	monitor: null,
	minimized: false,
};
const active = (
	audio: "off" | "on" | "lost",
	sessionId = 1,
): ScreenShareState => ({
	status: "active",
	sessionId,
	source,
	audio,
	quality: "1080p30",
	startedAt: 0,
	audioMode: { mode: "application", processId: 7 },
	cursor: true,
	paused: false,
});

describe("shareNotice", () => {
	it("avisa quando a fonte fecha, e não quando alguém para", () => {
		expect(
			shareNotice(active("on"), { status: "idle", ended: "sourceClosed" }),
		).toEqual({
			kind: "ended",
			source,
		});
		expect(shareNotice(active("on"), { status: "idle" })).toBeNull();
	});

	it("avisa quando só o áudio cai na mesma sessão", () => {
		expect(shareNotice(active("on"), active("lost"))).toEqual({
			kind: "audioLost",
			source,
		});
		expect(shareNotice(active("on", 1), active("lost", 2))).toBeNull();
		expect(shareNotice(active("lost"), active("lost"))).toBeNull();
	});

	it("avisa a falha uma vez", () => {
		const error: ScreenShareState = {
			status: "error",
			kind: "SourceNotFound",
			message: "x",
		};
		expect(shareNotice({ status: "starting" }, error)).toEqual({
			kind: "failed",
			errorKind: "SourceNotFound",
			message: "x",
		});
		expect(shareNotice(error, error)).toBeNull();
	});

	it("fica quieto no começo normal", () => {
		expect(shareNotice({ status: "idle" }, { status: "starting" })).toBeNull();
		expect(shareNotice({ status: "starting" }, active("on"))).toBeNull();
	});
});

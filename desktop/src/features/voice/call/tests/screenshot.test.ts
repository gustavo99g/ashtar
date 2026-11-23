import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { useSettingsStore } from "@/features/settings";
import { screenshotImage, screenshotSource } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import {
	screenshotName,
	screenshotTarget,
	takeScreenshot,
} from "../screenshot";
import { useRoomView } from "../stores/roomViewStore";

vi.mock("@/components/ui/toast", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/ui/toast")>()),
	toast: { add: vi.fn() },
}));
vi.mock("@/lib/tauri/commands", async (importOriginal) => ({
	...(await importOriginal<object>()),
	screenshotSource: vi.fn(async () => ({
		thumbnail: "data:image/jpeg;base64,AA",
		path: null,
	})),
	screenshotImage: vi.fn(async () => ({
		thumbnail: "data:image/jpeg;base64,AA",
		path: "C:\\Users\\kid\\Pictures\\Ashtar\\juju.png",
	})),
}));

const WINDOW = {
	source: { kind: "window", id: 7 },
	title: "Hades",
	processId: 42,
	icon: null,
	monitor: null,
	minimized: false,
} as const;

const SHARING = {
	status: "active",
	sessionId: 1,
	startedAt: 0,
	source: WINDOW,
	quality: "1080p60",
	audioMode: { mode: "off" },
	cursor: true,
	leveler: true,
	paused: false,
	audio: "off",
	link: "ok",
} as const;

/** Uma sala com `remote` transmitindo um `<video>` que já tem imagem. */
function fakeRoom(remote?: string) {
	const video = document.createElement("video");
	Object.defineProperty(video, "videoWidth", { value: 1920 });
	Object.defineProperty(video, "videoHeight", { value: 1080 });
	const participants = new Map<string, unknown>();
	if (remote) {
		participants.set(remote, { name: "juju" });
		participants.set(`${remote}:screen`, {
			name: "juju",
			getTrackPublication: () => ({
				videoTrack: { attachedElements: [video] },
			}),
		});
	}
	return {
		localParticipant: { identity: "eu", name: "kid" },
		remoteParticipants: participants,
	} as never;
}

afterEach(() => {
	useRoomView.setState({ watching: [], focused: null });
	useSettingsStore.setState({ saveScreenshots: false });
	vi.clearAllMocks();
});

describe("qual transmissão o print pega", () => {
	it("a em foco, depois a aberta, depois a própria", () => {
		expect(
			screenshotTarget({ focused: "ana", watching: ["bia", "ana"] }, true, "eu"),
		).toEqual({ kind: "remote", ownerId: "ana" });
		expect(screenshotTarget({ focused: null, watching: ["bia"] }, true, "eu")).toEqual(
			{ kind: "remote", ownerId: "bia" },
		);
		expect(screenshotTarget({ focused: null, watching: [] }, true, "eu")).toEqual({
			kind: "own",
		});
		// A própria aberta na sala também é a própria.
		expect(screenshotTarget({ focused: "eu", watching: ["eu"] }, true, "eu")).toEqual({
			kind: "own",
		});
		expect(screenshotTarget({ focused: null, watching: [] }, false, "eu")).toBeNull();
	});

	it("o nome do arquivo leva quem transmite e a hora", () => {
		expect(screenshotName("juju", new Date(2026, 10, 22, 21, 4))).toBe(
			"juju 2026-11-22 21-04",
		);
	});
});

describe("takeScreenshot", () => {
	it("sem sala ou sem transmissão nenhuma, não faz nada", async () => {
		expect(await takeScreenshot(null, null)).toBe(false);
		expect(await takeScreenshot(fakeRoom(), fakeShareController())).toBe(false);
		expect(screenshotSource).not.toHaveBeenCalled();
	});

	it("a própria vem do Rust, no tamanho cheio, e só copia", async () => {
		const taken = await takeScreenshot(
			fakeRoom(),
			fakeShareController(SHARING as never),
		);
		expect(taken).toBe(true);
		expect(screenshotSource).toHaveBeenCalledWith(WINDOW.source, null);
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Print copiado" }),
		);
	});

	it("a de outra pessoa sai do <video> e, com a opção ligada, é salva com o nome dela", async () => {
		const toDataURL = vi
			.spyOn(HTMLCanvasElement.prototype, "toDataURL")
			.mockReturnValue("data:image/png;base64,AA");
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as never);
		useSettingsStore.setState({ saveScreenshots: true });
		useRoomView.setState({ watching: ["juju-id"], focused: null });

		const taken = await takeScreenshot(fakeRoom("juju-id"), null);

		expect(taken).toBe(true);
		expect(toDataURL).toHaveBeenCalledWith("image/png");
		expect(screenshotImage).toHaveBeenCalledWith(
			"data:image/png;base64,AA",
			expect.stringMatching(/^juju \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/),
		);
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Print salvo e copiado" }),
		);
	});
});

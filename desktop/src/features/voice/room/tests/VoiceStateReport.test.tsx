import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ScreenShareController,
	setShareViewers,
} from "@/features/screen-share";
import { leaveVoiceState, putVoiceState } from "@/lib/api";
import { VoiceStateReport } from "../components/VoiceStateReport";

vi.mock("@/lib/api", () => ({
	putVoiceState: vi.fn(() => Promise.resolve()),
	leaveVoiceState: vi.fn(() => Promise.resolve()),
}));

let me: Record<string, unknown> | null = null;
vi.mock("../../members/hooks/useLiveMembers", () => ({
	useLiveMembers: () => (me ? [me] : []),
}));

const put = vi.mocked(putVoiceState);
const leave = vi.mocked(leaveVoiceState);

beforeEach(() => {
	put.mockClear();
	leave.mockClear();
	me = {
		id: "eu",
		isLocal: true,
		micOff: false,
		deafened: false,
		camera: false,
		sharing: false,
	};
});

describe("VoiceStateReport", () => {
	it("conta o estado ao entrar, a cada mudança e avisa ao sair", () => {
		const view = render(
			<VoiceStateReport channelId="sala" screenShare={null} />,
		);
		expect(put).toHaveBeenLastCalledWith("sala", {
			mic_off: false,
			deafened: false,
			camera: false,
			sharing: false,
			share: null,
		});

		me = { ...me, micOff: true, deafened: true, camera: true };
		view.rerender(<VoiceStateReport channelId="sala" screenShare={null} />);
		expect(put).toHaveBeenLastCalledWith("sala", {
			mic_off: true,
			deafened: true,
			camera: true,
			sharing: false,
			share: null,
		});
		expect(put).toHaveBeenCalledTimes(2);

		view.unmount();
		expect(leave).toHaveBeenCalledWith("sala");
	});

	it("sem a própria pessoa na lista ainda, não conta nada", () => {
		me = null;
		render(<VoiceStateReport channelId="sala" screenShare={null} />);
		expect(put).not.toHaveBeenCalled();
	});

	it("transmitindo, manda a fonte, o preset, o início e quantos assistem", () => {
		me = { ...me, sharing: true };
		setShareViewers([{ id: "a", name: "Ana", since: 1 }]);
		const state = {
			status: "active",
			startedAt: 1000,
			quality: "1080p60",
			paused: false,
			source: {
				title: "Valorant",
				source: { kind: "window", id: 1 },
			},
		};
		const controller = {
			getState: () => state,
			onStateChange: () => () => {},
		} as unknown as ScreenShareController;
		render(<VoiceStateReport channelId="sala" screenShare={controller} />);
		expect(put).toHaveBeenLastCalledWith("sala", {
			mic_off: false,
			deafened: false,
			camera: false,
			sharing: true,
			share: {
				title: "Valorant",
				window: true,
				quality: "1080p60",
				started_at: 1000,
				viewers: 1,
			},
		});
		setShareViewers([]);
	});
});

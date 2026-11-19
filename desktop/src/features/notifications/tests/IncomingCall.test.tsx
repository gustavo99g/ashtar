import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationAnswer, notificationLayout } from "@/lib/tauri/commands";
import { NotificationStack, receiveRing } from "../components/NotificationStack";
import { parseRing } from "../model/ring";
import { clearStack, useStack } from "../stores/stackStore";

vi.mock("@/lib/tauri/commands", () => ({
	notificationLayout: vi.fn(() => Promise.resolve()),
	notificationOpen: vi.fn(() => Promise.resolve()),
	notificationAnswer: vi.fn(() => Promise.resolve()),
	onNotificationCard: vi.fn(() => Promise.resolve(() => {})),
	onNotificationRing: vi.fn(() => Promise.resolve(() => {})),
}));

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		disconnect() {}
	},
);

/** O `Audio` do jsdom não toca: este guarda o que o toque pediu. */
const played: { volume: number; loop: boolean; paused: boolean }[] = [];
vi.stubGlobal(
	"Audio",
	class {
		volume = 1;
		loop = false;
		paused = true;
		currentTime = 0;
		constructor() {
			played.push(this);
		}
		play() {
			this.paused = false;
			return Promise.resolve();
		}
		pause() {
			this.paused = true;
		}
	},
);

const ring = {
	callId: "c1",
	channelId: "d1",
	person: { nick: "kid", displayName: "Kid" },
	inRoom: false,
	sharing: false,
};

describe("o cartão da ligação", () => {
	beforeEach(() => {
		clearStack();
		played.length = 0;
		vi.mocked(notificationAnswer).mockClear();
		vi.mocked(notificationLayout).mockClear();
	});
	afterEach(() => vi.useRealTimers());

	it("aparece em cima, toca em repetição, e os botões respondem à janela principal", async () => {
		render(<NotificationStack />);
		act(() => receiveRing(ring));
		expect(screen.getByText("Ligando para você…")).toBeInTheDocument();
		expect(played).toHaveLength(1);
		expect(played[0]).toMatchObject({ loop: true, volume: 0.8 });

		await userEvent.click(screen.getByRole("button", { name: /Atender/ }));
		expect(notificationAnswer).toHaveBeenCalledWith({
			callId: "c1",
			action: "accept",
		});
		await userEvent.click(
			screen.getByRole("button", { name: /Responder com mensagem/ }),
		);
		expect(notificationAnswer).toHaveBeenLastCalledWith({
			callId: "c1",
			action: "reply",
		});

		// O `null` da janela principal tira o cartão e para o toque.
		act(() => receiveRing(null));
		expect(screen.queryByText("Ligando para você…")).not.toBeInTheDocument();
		expect(played[0].paused).toBe(true);
		expect(notificationLayout).toHaveBeenLastCalledWith(0);
	});

	it("numa sala, vira Sair e atender, e o toque é mais baixo; transmitindo, avisa", () => {
		render(<NotificationStack />);
		act(() => receiveRing({ ...ring, inRoom: true, sharing: true }));
		expect(
			screen.getByRole("button", { name: /Sair e atender/ }),
		).toBeInTheDocument();
		expect(
			screen.getByText("Atender encerra a sua transmissão."),
		).toBeInTheDocument();
		expect(played[0].volume).toBe(0.3);
	});

	it("sem resposta, sai sozinho para o toque não ficar preso", () => {
		vi.useFakeTimers();
		render(<NotificationStack />);
		act(() => receiveRing(ring));
		act(() => vi.advanceTimersByTime(40_000));
		expect(useStack.getState().ring).toBeNull();
	});

	it("ignora o que não tem a forma de um cartão de ligação", () => {
		expect(parseRing({ callId: "c1" })).toBeNull();
		expect(parseRing(null)).toBeNull();
		expect(parseRing({ ...ring, inRoom: "sim" })).toMatchObject({
			inRoom: false,
		});
	});
});

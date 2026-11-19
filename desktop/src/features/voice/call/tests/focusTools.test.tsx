import type { TrackReference } from "@livekit/components-react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CopyFrameButton,
	InboundStatsButton,
	ZoomableVideo,
} from "../components/FocusTools";

vi.mock("../model/frame", () => ({
	captureFrame: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
	copyImage: vi.fn(async () => undefined),
}));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function shareWith(getRTCStatsReport: () => Promise<RTCStatsReport | undefined>) {
	return {
		participant: { identity: "juju:screen" },
		publication: {
			isSubscribed: true,
			isMuted: false,
			simulcasted: false,
			track: { getRTCStatsReport },
		},
	} as unknown as TrackReference;
}

describe("ZoomableVideo", () => {
	it("a roda amplia e o duplo clique volta ao 1×", () => {
		render(
			<ZoomableVideo>
				<video />
			</ZoomableVideo>,
		);
		const box = screen.getByTestId("zoomable-video");
		vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
			left: 0,
			top: 0,
			width: 800,
			height: 450,
		} as DOMRect);
		act(() => {
			box.dispatchEvent(
				new WheelEvent("wheel", { deltaY: -400, clientX: 400, clientY: 225, cancelable: true }),
			);
		});
		expect(screen.getByRole("button", { name: "Voltar ao 1×" })).toBeTruthy();
		fireEvent.doubleClick(box);
		expect(screen.queryByRole("button", { name: "Voltar ao 1×" })).toBeNull();
	});
});

describe("InboundStatsButton", () => {
	it("fechado, não lê nenhuma estatística", () => {
		const read = vi.fn(async () => undefined);
		render(<InboundStatsButton share={shareWith(read)} />);
		expect(screen.getByRole("button", { name: "Como está chegando" })).toBeTruthy();
		expect(read).not.toHaveBeenCalled();
	});

	it("aberto, lê e mostra a frase", async () => {
		const read = vi.fn(async () => undefined);
		render(<InboundStatsButton share={shareWith(read)} />);
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Como está chegando" }));
		});
		expect(read).toHaveBeenCalled();
		expect(screen.getByText("Medindo…")).toBeTruthy();
	});
});

describe("CopyFrameButton", () => {
	it("copia e avisa no próprio botão", async () => {
		render(<CopyFrameButton videoOf={() => document.createElement("video")} />);
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Copiar um quadro" }));
		});
		expect(screen.getByRole("status").textContent).toBe("Quadro copiado");
	});
});

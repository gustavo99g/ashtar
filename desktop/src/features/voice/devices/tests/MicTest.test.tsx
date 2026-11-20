import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Room } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInputGraph } from "../../input/chain";
import { emitInputLevel } from "../../input/model/levelBus";
import { DEFAULT_INPUT, useInputChoice } from "../../input/stores/inputStore";
import {
	VoiceContext,
	type VoiceContextValue,
} from "../../room/components/VoiceProvider";
import { litBars, MicTest } from "../components/MicTest";
import { useDeviceChoice } from "../stores/deviceChoiceStore";

vi.mock("../../input/chain", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../input/chain")>()),
	buildInputGraph: vi.fn(),
}));

const mic = { stop: vi.fn(), applyConstraints: vi.fn(async () => {}) };
const graph = {
	output: {} as MediaStreamTrack,
	rnnoise: true,
	update: vi.fn(),
	close: vi.fn(async () => {}),
};
const getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [mic] }));
const played = { play: vi.fn(async () => {}), pause: vi.fn(), setSinkId: vi.fn(async () => {}) };

beforeEach(() => {
	vi.mocked(buildInputGraph).mockResolvedValue(graph);
	Object.defineProperty(navigator, "mediaDevices", {
		value: { getUserMedia },
		configurable: true,
	});
	vi.stubGlobal(
		"MediaStream",
		class {
			constructor(public tracks: MediaStreamTrack[]) {}
		},
	);
	vi.stubGlobal(
		"Audio",
		class {
			srcObject: unknown = null;
			play = played.play;
			pause = played.pause;
			setSinkId = played.setSinkId;
		},
	);
	useInputChoice.setState(DEFAULT_INPUT);
	useDeviceChoice.setState({
		input: { id: "mic-usb", label: "Headset" },
		output: { id: "fone", label: "Fone" },
	});
});

afterEach(() => {
	Reflect.deleteProperty(navigator, "mediaDevices");
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("Testar microfone", () => {
	it("fora da sala, abre o microfone escolhido pela cadeia e toca na saída escolhida", async () => {
		const user = userEvent.setup();
		render(<MicTest />);

		await user.click(screen.getByRole("button", { name: "Testar microfone" }));

		await vi.waitFor(() => expect(played.play).toHaveBeenCalled());
		expect(getUserMedia).toHaveBeenCalledWith({
			audio: expect.objectContaining({
				deviceId: { ideal: "mic-usb" },
				noiseSuppression: false,
			}),
		});
		expect(buildInputGraph).toHaveBeenCalledWith(
			mic,
			expect.objectContaining({ suppression: true }),
		);
		expect(played.setSinkId).toHaveBeenCalledWith("fone");
		expect(
			screen.getByRole("button", { name: "Parar de testar" }),
		).toBeInTheDocument();
	});

	it("parar, ou sair da tela, fecha o microfone e a cadeia", async () => {
		const user = userEvent.setup();
		const { unmount } = render(<MicTest />);
		await user.click(screen.getByRole("button", { name: "Testar microfone" }));
		await vi.waitFor(() => expect(played.play).toHaveBeenCalled());

		unmount();

		expect(graph.close).toHaveBeenCalled();
		expect(mic.stop).toHaveBeenCalled();
		expect(played.pause).toHaveBeenCalled();
	});

	it("mudar o volume no meio do teste vale sem reabrir o microfone", async () => {
		const user = userEvent.setup();
		render(<MicTest />);
		await user.click(screen.getByRole("button", { name: "Testar microfone" }));
		await vi.waitFor(() => expect(played.play).toHaveBeenCalled());

		useInputChoice.setState({ volume: 150 });

		await vi.waitFor(() =>
			expect(graph.update).toHaveBeenCalledWith(
				expect.objectContaining({ volume: 150 }),
			),
		);
		expect(getUserMedia).toHaveBeenCalledTimes(1);
	});

	it("numa sala, não toca o próprio som: só mostra o nível", async () => {
		const user = userEvent.setup();
		render(
			<VoiceContext.Provider
				value={{ room: {} as Room } as VoiceContextValue}
			>
				<MicTest />
			</VoiceContext.Provider>,
		);

		await user.click(screen.getByRole("button", { name: "Testar microfone" }));
		emitInputLevel({ level: -50, open: true, threshold: -60 });

		expect(getUserMedia).not.toHaveBeenCalled();
		expect(screen.getByText(/o teste só mostra o nível/)).toBeInTheDocument();
		await vi.waitFor(() =>
			expect(
				screen.getByRole("meter", { name: "Nível do microfone" }),
			).toHaveAttribute("aria-valuenow", "10"),
		);
	});

	it("o medidor vai de nenhuma barra no silêncio a todas no máximo", () => {
		expect(litBars(null)).toBe(0);
		expect(litBars(-100)).toBe(0);
		expect(litBars(-50)).toBe(10);
		expect(litBars(0)).toBe(20);
	});
});

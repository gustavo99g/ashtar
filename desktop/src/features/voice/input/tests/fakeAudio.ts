import { vi } from "vitest";
import type { InputAudio } from "../chain";

/**
 * O jsdom não tem Web Audio: um grafo de mentira que anota quem liga em quem. O portão guarda o
 * que recebeu pela porta, e `level` faz de conta que ele mediu.
 */
export function fakeAudio(processed = { stop: vi.fn() } as unknown as MediaStreamTrack) {
	const node = () => {
		const n = {
			connect: vi.fn((next: unknown) => next),
			disconnect: vi.fn(),
			destroy: vi.fn(),
		};
		return n;
	};
	const source = node();
	const gain = { ...node(), gain: { value: 1 } };
	const rnnoise = node();
	const gate = {
		...node(),
		port: {
			onmessage: null as ((event: MessageEvent) => void) | null,
			postMessage: vi.fn(),
		},
	};
	const context = {
		state: "running" as AudioContextState,
		createMediaStreamSource: vi.fn(() => source),
		createGain: vi.fn(() => gain),
		createMediaStreamDestination: vi.fn(() => ({
			stream: { getAudioTracks: () => [processed] },
		})),
		resume: vi.fn(async () => {}),
		close: vi.fn(async () => {
			context.state = "closed";
		}),
	};
	const audio = {
		createContext: vi.fn(() => context as unknown as AudioContext),
		loadWasm: vi.fn(async () => new ArrayBuffer(8)),
		addRnnoiseWorklet: vi.fn(async () => {}),
		createRnnoise: vi.fn(
			async () => rnnoise as unknown as AudioWorkletNode & { destroy?: () => void },
		),
		addGateWorklet: vi.fn(async () => {}),
		createGate: vi.fn(() => gate as unknown as AudioWorkletNode),
	} satisfies InputAudio;
	/** O último pedido que o portão recebeu. */
	const lastParams = () => gate.port.postMessage.mock.lastCall?.[0]?.params;
	const level = (data: unknown) =>
		gate.port.onmessage?.({ data } as MessageEvent);
	return { audio, context, source, gain, rnnoise, gate, processed, lastParams, level };
}

/** O microfone de verdade: só as restrições que o teste confere. */
export function micTrack() {
	return {
		getConstraints: () => ({ deviceId: "mic-usb" }),
		applyConstraints: vi.fn(async () => {}),
	} as unknown as MediaStreamTrack & {
		applyConstraints: ReturnType<typeof vi.fn>;
	};
}

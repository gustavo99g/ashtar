import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
	type CaptureSource,
	thumbnailsStart,
	thumbnailsUpdate,
} from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import { SourcePicker } from "../components/SourcePicker";

vi.mock("@/lib/tauri/commands", () => ({
	thumbnailsStart: vi.fn(async () => 3),
	thumbnailsUpdate: vi.fn(async () => {}),
	thumbnailsStop: vi.fn(async () => {}),
}));

class FakeIO {
	cb: IntersectionObserverCallback;
	constructor(cb: IntersectionObserverCallback) {
		this.cb = cb;
	}
	observe(el: Element) {
		queueMicrotask(() =>
			this.cb(
				[{ target: el, isIntersecting: true } as IntersectionObserverEntry],
				this as unknown as IntersectionObserver,
			),
		);
	}
	unobserve() {}
	disconnect() {}
}

beforeEach(() => {
	vi.stubGlobal("IntersectionObserver", FakeIO);
	URL.createObjectURL = vi.fn(() => "blob:x");
	URL.revokeObjectURL = vi.fn();
});

const sources: CaptureSource[] = [
	{ source: { kind: "window", id: 1 }, title: "Navegador", processId: 7, icon: null, monitor: null, minimized: false },
	{ source: { kind: "window", id: 2 }, title: "Outro", processId: 8, icon: null, monitor: null, minimized: false },
];

/**
 * Regressão: no `StrictMode` (o dev do app), o `ref` de cada card mudava a cada desenho, e a lista de
 * janelas à vista alternava entre cheia e vazia sem parar. O Rust recomeçava todas as capturas a
 * cada troca, e as janelas ficavam só com o ícone.
 */
it("a lista de janelas à vista se estabiliza no StrictMode", async () => {
	render(
		<StrictMode>
			<SourcePicker
				controller={fakeShareController({ status: "idle" }, sources)}
				channelName="Jogatina"
				open
				onClose={() => {}}
			/>
		</StrictMode>,
	);
	await screen.findByText("Navegador");
	await new Promise((r) => setTimeout(r, 300));
	const updates = vi.mocked(thumbnailsUpdate).mock.calls;
	// Poucas trocas (a vazia do começo e a cheia), e a última leva as duas janelas.
	expect(updates.length).toBeLessThanOrEqual(3);
	expect(updates[updates.length - 1]?.[1]).toEqual([
		{ kind: "window", id: 1 },
		{ kind: "window", id: 2 },
	]);
	expect(vi.mocked(thumbnailsStart)).toHaveBeenCalledTimes(1);
});

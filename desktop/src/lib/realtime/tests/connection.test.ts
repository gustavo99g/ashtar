import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
	backoffMs,
	createRealtime,
	IDLE_MS,
	PING_MS,
	type RealtimeStatus,
} from "../connection";

/** Um WebSocket de mentira: guarda o que foi mandado e deixa o teste disparar os eventos. */
class FakeSocket {
	static all: FakeSocket[] = [];
	readyState = 0;
	sent: string[] = [];
	closed = false;
	onopen: (() => void) | null = null;
	onmessage: ((message: { data: unknown }) => void) | null = null;
	onclose: ((close: { code: number }) => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(public url: string) {
		FakeSocket.all.push(this);
	}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.closed = true;
		this.readyState = 3;
	}
	// Do lado da API:
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	receive(event: unknown) {
		this.onmessage?.({ data: JSON.stringify(event) });
	}
	drop(code = 1006) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];
const ready = { type: "ready", user_id: "u1", online: ["u1"], channels: [] };

function setup(getTicket = vi.fn(() => Promise.resolve("t"))) {
	const realtime = createRealtime({
		getTicket,
		url: (ticket) => `ws://api/realtime?ticket=${ticket}`,
		createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
		random: () => 0.5,
	});
	const statuses: RealtimeStatus[] = [];
	realtime.onStatus((status) => statuses.push(status));
	const events: unknown[] = [];
	const infos: { type: string; resumed: boolean }[] = [];
	realtime.onEvent((event, info) => {
		events.push(event);
		infos.push({ type: event.type, resumed: info.resumed });
	});
	return { realtime, statuses, events, infos, getTicket };
}

/** Deixa as promessas (o ticket) andarem. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.all = [];
});
afterEach(() => {
	vi.useRealTimers();
});

describe("backoffMs", () => {
	it("dobra até 30 segundos, com 20% de sorteio", () => {
		expect([0, 1, 2, 3, 4, 5, 9].map((n) => backoffMs(n, 0.5))).toEqual([
			1000, 2000, 4000, 8000, 16000, 30000, 30000,
		]);
		expect(backoffMs(0, 0)).toBe(800);
		expect(backoffMs(0, 1)).toBe(1200);
	});
});

describe("createRealtime", () => {
	it("conecta com o ticket e fica aberta no ready", async () => {
		const { realtime, statuses, events } = setup();
		realtime.start();
		await flush();
		expect(latest().url).toBe("ws://api/realtime?ticket=t");
		expect(realtime.status()).toBe("connecting");

		latest().open();
		latest().receive(ready);
		expect(statuses).toEqual(["connecting", "open"]);
		expect(events).toEqual([ready]);
	});

	it("manda ping a cada 25 s e não repassa o pong", async () => {
		const { realtime, events } = setup();
		realtime.start();
		await flush();
		latest().open();
		latest().receive(ready);

		vi.advanceTimersByTime(PING_MS);
		expect(latest().sent).toEqual(["ping"]);
		latest().receive({ type: "pong" });
		expect(events).toEqual([ready]);
	});

	it("reconecta com espera crescente e zera no ready", async () => {
		const { realtime, getTicket } = setup();
		realtime.start();
		await flush();
		latest().drop();
		expect(realtime.status()).toBe("reconnecting");

		await vi.advanceTimersByTimeAsync(999);
		expect(getTicket).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(getTicket).toHaveBeenCalledTimes(2);

		// A segunda queda espera 2 s.
		latest().drop();
		await vi.advanceTimersByTimeAsync(1999);
		expect(getTicket).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(getTicket).toHaveBeenCalledTimes(3);

		// Com o ready, a próxima queda volta a esperar 1 s.
		latest().open();
		latest().receive(ready);
		expect(realtime.status()).toBe("open");
		latest().drop();
		await vi.advanceTimersByTimeAsync(1000);
		expect(getTicket).toHaveBeenCalledTimes(4);
	});

	it("só o ready depois de uma queda é uma volta; um start novo recomeça", async () => {
		const { realtime, infos } = setup();
		realtime.start();
		await flush();
		latest().open();
		latest().receive(ready);
		latest().receive({ type: "member.left", user_id: "u2" });
		latest().drop();
		await vi.advanceTimersByTimeAsync(1000);
		latest().open();
		latest().receive(ready);

		realtime.stop();
		realtime.start();
		await flush();
		latest().open();
		latest().receive(ready);

		expect(infos).toEqual([
			{ type: "ready", resumed: false },
			{ type: "member.left", resumed: true },
			{ type: "ready", resumed: true },
			{ type: "ready", resumed: false },
		]);
	});

	it("60 s sem nada da API derruba e volta", async () => {
		const { realtime, getTicket } = setup();
		realtime.start();
		await flush();
		latest().open();
		latest().receive(ready);
		const first = latest();

		vi.advanceTimersByTime(IDLE_MS - 1);
		latest().receive({ type: "pong" });
		vi.advanceTimersByTime(IDLE_MS - 1);
		expect(realtime.status()).toBe("open");
		vi.advanceTimersByTime(1);
		expect(first.closed).toBe(true);
		expect(realtime.status()).toBe("reconnecting");
		await vi.advanceTimersByTimeAsync(1000);
		expect(getTicket).toHaveBeenCalledTimes(2);
	});

	it("4001 encerra sem reconectar", async () => {
		const { realtime, getTicket } = setup();
		realtime.start();
		await flush();
		latest().open();
		latest().receive(ready);
		latest().drop(4001);
		expect(realtime.status()).toBe("ended");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(getTicket).toHaveBeenCalledTimes(1);
	});

	it("ticket sem rede tenta de novo; recusado por regra encerra", async () => {
		const network = new ApiError({ status: 0, kind: "network", message: "" });
		const refused = new ApiError({
			status: 401,
			kind: "unauthenticated",
			message: "",
		});
		const getTicket = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(network)
			.mockRejectedValueOnce(refused);
		const { realtime } = setup(getTicket);
		realtime.start();
		await flush();
		expect(realtime.status()).toBe("reconnecting");
		await vi.advanceTimersByTimeAsync(1000);
		expect(getTicket).toHaveBeenCalledTimes(2);
		expect(realtime.status()).toBe("ended");
	});

	it("stop fecha e um ticket que chega depois não conecta", async () => {
		let resolve: (ticket: string) => void = () => {};
		const getTicket = vi.fn(
			() =>
				new Promise<string>((r) => {
					resolve = r;
				}),
		);
		const { realtime } = setup(getTicket);
		realtime.start();
		realtime.stop();
		resolve("t");
		await flush();
		expect(FakeSocket.all).toHaveLength(0);
		expect(realtime.status()).toBe("idle");

		realtime.start();
		resolve("t2");
		await flush();
		latest().open();
		realtime.stop();
		expect(latest().closed).toBe(true);
	});
});

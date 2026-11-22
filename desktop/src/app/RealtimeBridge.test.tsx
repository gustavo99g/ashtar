import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { getMe, type MeResponse, type UserView } from "@/lib/api";
import {
	type RealtimeStatus,
	restartRealtime,
	startRealtime,
	stopRealtime,
	useRealtimeStatus,
} from "@/lib/realtime";
import { RESTART_GAP_MS, RealtimeBridge } from "./RealtimeBridge";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getMe: vi.fn(),
}));
vi.mock("@/lib/realtime", () => ({
	startRealtime: vi.fn(),
	stopRealtime: vi.fn(),
	restartRealtime: vi.fn(),
	subscribeRealtime: vi.fn(() => () => {}),
	useRealtimeStatus: vi.fn(() => "idle"),
	useRealtimeOpen: vi.fn(() => false),
}));

const user: UserView = {
	id: "u1",
	nick: "kid",
	display_name: null,
	is_owner: false,
};

const me: MeResponse = {
	user,
	permissions: [],
	update_channel: "stable",
	status: "available",
	can_create_invite: false,
	can_view_panel: false,
	can_manage_channels: false,
	can_move_members: false, can_manage_emojis: false, can_view_logs: false,
};

/** Monta a ponte. `rerender` desenha de novo, para ela ler o status novo. */
function renderBridge() {
	const client = new QueryClient();
	const tree = () => (
		<QueryClientProvider client={client}>
			<RealtimeBridge />
		</QueryClientProvider>
	);
	const view = render(tree());
	return { rerender: () => view.rerender(tree()) };
}

function setStatus(status: RealtimeStatus) {
	vi.mocked(useRealtimeStatus).mockReturnValue(status);
}

/** Deixa os timers andarem e as promessas resolverem. */
async function advance(ms: number) {
	await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
	vi.useFakeTimers();
	useSessionStore.setState({ session: { status: "connected", user } });
	vi.mocked(getMe).mockResolvedValue(me);
	setStatus("idle");
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("RealtimeBridge", () => {
	it("liga com a sessão conectada e desliga quando ela sai", () => {
		renderBridge();
		expect(startRealtime).toHaveBeenCalledTimes(1);

		act(() => useSessionStore.setState({ session: { status: "entering" } }));
		expect(stopRealtime).toHaveBeenCalledTimes(1);
	});

	it("sem sessão, não liga", () => {
		useSessionStore.setState({ session: { status: "entering" } });
		renderBridge();
		expect(startRealtime).not.toHaveBeenCalled();
	});

	it("encerrada com a sessão valendo, confere o /api/me e liga de novo", async () => {
		setStatus("ended");
		renderBridge();
		await advance(0);
		expect(getMe).toHaveBeenCalledTimes(1);
		expect(restartRealtime).toHaveBeenCalledTimes(1);
	});

	it("encerrada de novo logo depois, espera completar os 30 s em vez de desistir", async () => {
		setStatus("ended");
		const view = renderBridge();
		await advance(0);
		expect(restartRealtime).toHaveBeenCalledTimes(1);

		// Abriu e caiu com 4001 de novo, 10 s depois.
		await advance(10_000);
		setStatus("open");
		view.rerender();
		setStatus("ended");
		view.rerender();
		await advance(0);
		expect(getMe).toHaveBeenCalledTimes(2);
		expect(restartRealtime).toHaveBeenCalledTimes(1);

		await advance(RESTART_GAP_MS - 10_000 - 1);
		expect(restartRealtime).toHaveBeenCalledTimes(1);
		await advance(1);
		expect(restartRealtime).toHaveBeenCalledTimes(2);
	});

	it("se o /api/me falhar, não liga (o SessionWatcher cuida da sessão)", async () => {
		vi.mocked(getMe).mockRejectedValue(new Error("unknown_device"));
		setStatus("ended");
		renderBridge();
		await advance(RESTART_GAP_MS);
		expect(restartRealtime).not.toHaveBeenCalled();
	});
});

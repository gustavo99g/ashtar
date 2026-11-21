import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { listMessages, type UserView } from "@/lib/api";
import { useRealtimeOpen } from "@/lib/realtime";
import { useAppVisible } from "@/lib/visibility";
import {
	chatKeys,
	type MessagePages,
	OFFLINE_CATCH_UP_MS,
	useOfflineCatchUp,
} from "../queries";
import { addPending, clearOutbox, useOutbox } from "../stores/outboxStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listMessages: vi.fn(),
}));
vi.mock("@/lib/visibility", () => ({ useAppVisible: vi.fn(() => true) }));
vi.mock("@/lib/realtime", () => ({ useRealtimeOpen: vi.fn(() => false) }));

const user: UserView = {
	id: "u1",
	nick: "kid",
	display_name: null,
	is_owner: false,
};

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Deixa os timers andarem e as promessas resolverem. */
async function advance(ms: number) {
	await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
	vi.useFakeTimers();
	useSessionStore.setState({ session: { status: "connected", user } });
	client = new QueryClient();
	client.setQueryData<MessagePages>(chatKeys.messages("geral"), {
		pages: [
			{
				messages: [
					{
						id: "m1",
						channel_id: "geral",
						client_id: "c1",
						author: { id: "u2", nick: "ana", display_name: null, removed: false },
						body: "oi",
						mentions: [],
						created_at: 1,
						kind: "text",
						edited_at: null,
						reply_to: null,
						reactions: [],
						pinned_at: null,
						attachments: [],
						previews: [],
						call: null,
					},
				],
				has_more: false,
			},
		],
		pageParams: [null],
	});
	vi.mocked(listMessages).mockResolvedValue({ messages: [], has_more: false });
});

afterEach(() => {
	vi.useRealTimers();
	vi.mocked(listMessages).mockReset();
	vi.mocked(useRealtimeOpen).mockReturnValue(false);
	vi.mocked(useAppVisible).mockReturnValue(true);
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("useOfflineCatchUp", () => {
	it("com o tempo real fora, pergunta o que chegou de 15 em 15 segundos", async () => {
		renderHook(() => useOfflineCatchUp(), { wrapper });
		await advance(OFFLINE_CATCH_UP_MS - 1);
		expect(listMessages).not.toHaveBeenCalled();
		await advance(1);
		expect(listMessages).toHaveBeenCalledWith("geral", { after: "m1" });
		await advance(OFFLINE_CATCH_UP_MS);
		expect(listMessages).toHaveBeenCalledTimes(2);
	});

	it("com o tempo real aberto, ou o app fora de vista, não pergunta", async () => {
		vi.mocked(useRealtimeOpen).mockReturnValue(true);
		const { rerender } = renderHook(() => useOfflineCatchUp(), { wrapper });
		await advance(OFFLINE_CATCH_UP_MS * 3);

		vi.mocked(useRealtimeOpen).mockReturnValue(false);
		vi.mocked(useAppVisible).mockReturnValue(false);
		rerender();
		await advance(OFFLINE_CATCH_UP_MS * 3);
		expect(listMessages).not.toHaveBeenCalled();
	});

	it("sem sessão, não pergunta", async () => {
		useSessionStore.setState({ session: { status: "entering" } });
		renderHook(() => useOfflineCatchUp(), { wrapper });
		await advance(OFFLINE_CATCH_UP_MS * 2);
		expect(listMessages).not.toHaveBeenCalled();
	});
});

describe("clearOutbox", () => {
	it("esquece tudo o que estava saindo", () => {
		addPending({
			client_id: "c1",
			channel_id: "geral",
			body: "oi",
			created_at: 1,
			status: "failed",
		});
		clearOutbox();
		expect(useOutbox.getState().pending).toEqual([]);
	});
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { listVoiceParticipants, type UserView } from "@/lib/api";
import { useAppVisible } from "@/lib/visibility";
import { PARTICIPANTS_REFRESH_MS, useVoiceParticipants } from "../queries";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listVoiceParticipants: vi.fn(),
}));
vi.mock("@/lib/visibility", () => ({ useAppVisible: vi.fn() }));

const user: UserView = {
	id: "u1",
	nick: "kid",
	display_name: null,
	is_owner: false,
};

function wrapper({ children }: { children: ReactNode }) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

/** Deixa os timers andarem e as promessas resolverem. */
async function advance(ms: number) {
	await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
	vi.useFakeTimers();
	useSessionStore.setState({ session: { status: "connected", user } });
	vi.mocked(listVoiceParticipants).mockResolvedValue([]);
	vi.mocked(useAppVisible).mockReturnValue(true);
});

afterEach(() => {
	vi.useRealTimers();
	vi.mocked(listVoiceParticipants).mockReset();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("useVoiceParticipants", () => {
	it("pergunta de 5 em 5 segundos com o app à vista", async () => {
		renderHook(() => useVoiceParticipants("sala"), { wrapper });
		await advance(0);
		expect(listVoiceParticipants).toHaveBeenCalledTimes(1);
		expect(listVoiceParticipants).toHaveBeenCalledWith("sala");

		await advance(PARTICIPANTS_REFRESH_MS);
		expect(listVoiceParticipants).toHaveBeenCalledTimes(2);

		await advance(PARTICIPANTS_REFRESH_MS);
		expect(listVoiceParticipants).toHaveBeenCalledTimes(3);
	});

	it("para com o app fora de vista e busca na hora quando ele volta", async () => {
		const { rerender } = renderHook(() => useVoiceParticipants("sala"), {
			wrapper,
		});
		await advance(0);

		vi.mocked(useAppVisible).mockReturnValue(false);
		rerender();
		await advance(PARTICIPANTS_REFRESH_MS * 3);
		expect(listVoiceParticipants).toHaveBeenCalledTimes(1);

		vi.mocked(useAppVisible).mockReturnValue(true);
		rerender();
		await advance(0);
		expect(listVoiceParticipants).toHaveBeenCalledTimes(2);
	});

	it("não pergunta com enabled: false (dentro da chamada) nem sem sessão", async () => {
		renderHook(() => useVoiceParticipants("sala", { enabled: false }), {
			wrapper,
		});
		await advance(PARTICIPANTS_REFRESH_MS * 2);
		expect(listVoiceParticipants).not.toHaveBeenCalled();

		useSessionStore.setState({ session: { status: "entering" } });
		renderHook(() => useVoiceParticipants("sala"), { wrapper });
		await advance(PARTICIPANTS_REFRESH_MS * 2);
		expect(listVoiceParticipants).not.toHaveBeenCalled();
	});
});

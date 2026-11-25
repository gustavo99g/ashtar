import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MeResponse, setStatus } from "@/lib/api";
import { identityKeys, useMyStatus, useSetStatus } from "../queries";
import { handleIdentityRealtime } from "../realtime";
import { useSessionStore } from "../stores/sessionStore";
import { useLastStatus } from "../stores/statusStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getMe: vi.fn(() => new Promise(() => {})),
	setStatus: vi.fn(),
}));

const kid = { id: "kid", nick: "kid", display_name: null, is_owner: true };

function me(status: MeResponse["status"]): MeResponse {
	return {
		user: kid,
		permissions: [],
		update_channel: "stable",
		status,
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: true,
		can_move_members: true, can_manage_emojis: false, can_view_logs: false, can_moderate_voice: false, can_send_sounds: false, can_approve_sounds: false,
	};
}

function setup(cached: MeResponse | null) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	if (cached) client.setQueryData(identityKeys.me(), cached);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return { client, wrapper };
}

const cachedStatus = (client: QueryClient) =>
	client.getQueryData<MeResponse>(identityKeys.me())?.status;

beforeEach(() => {
	localStorage.clear();
	useLastStatus.setState({ last: "available" });
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	vi.mocked(setStatus).mockReset();
});

describe("o status de quem usa", () => {
	it("antes do /api/me, vale o último que este computador viu; depois, o da API, que fica guardado", async () => {
		useLastStatus.setState({ last: "busy" });
		const { client, wrapper } = setup(null);
		const view = renderHook(() => useMyStatus(), { wrapper });
		expect(view.result.current).toBe("busy");

		act(() => client.setQueryData(identityKeys.me(), me("invisible")));
		await waitFor(() => expect(view.result.current).toBe("invisible"));
		expect(localStorage.getItem("ashtar-status")).toContain('"invisible"');
	});

	it("trocar muda na hora e fica com a resposta da API", async () => {
		vi.mocked(setStatus).mockResolvedValue(me("busy"));
		const { client, wrapper } = setup(me("available"));
		const view = renderHook(() => useSetStatus(), { wrapper });
		act(() => view.result.current.mutate("busy"));
		expect(cachedStatus(client)).toBe("busy");
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
		expect(setStatus).toHaveBeenCalledWith("busy");
		expect(useLastStatus.getState().last).toBe("busy");
	});

	it("se a API recusar, volta como estava", async () => {
		vi.mocked(setStatus).mockRejectedValue(new Error("rede"));
		const { client, wrapper } = setup(me("available"));
		const view = renderHook(() => useSetStatus(), { wrapper });
		act(() => view.result.current.mutate("invisible"));
		await waitFor(() => expect(view.result.current.isError).toBe(true));
		expect(cachedStatus(client)).toBe("available");
	});

	it("o ready e o status.changed (de outro computador) trocam o do cache", () => {
		const { client } = setup(me("available"));
		handleIdentityRealtime({ type: "status.changed", status: "busy" }, client);
		expect(cachedStatus(client)).toBe("busy");
		handleIdentityRealtime(
			{
				type: "ready",
				call: null,
				user_id: "kid",
				status: "invisible",
				online: [],
				busy: [], away: [],
				channels: [],
				dms: [],
			},
			client,
		);
		expect(cachedStatus(client)).toBe("invisible");
	});

	it("um valor estranho no disco volta para Disponível", async () => {
		localStorage.setItem(
			"ashtar-status",
			JSON.stringify({ state: { last: "dormindo" }, version: 1 }),
		);
		await useLastStatus.persist.rehydrate();
		expect(useLastStatus.getState().last).toBe("available");
	});
});

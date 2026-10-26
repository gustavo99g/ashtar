import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, clearSession, type UserView } from "@/lib/api";
import { login } from "@/lib/tauri/commands";
import { identityKeys } from "../queries";
import { SessionWatcher } from "../SessionWatcher";
import { startSession, useSessionStore } from "../session";

vi.mock("@/lib/tauri/commands", () => ({
	login: vi.fn(),
	accountMarker: vi.fn(() => Promise.resolve(null)),
	checkForUpdate: vi.fn(() => Promise.resolve()),
}));

const user: UserView = {
	id: "u1",
	nick: "kid",
	display_name: null,
	is_owner: false,
};
const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

function renderWatcher(onLeftGroup: () => void) {
	const queryClient = new QueryClient();
	queryClient.setQueryData(identityKeys.me(), { user });
	render(
		<QueryClientProvider client={queryClient}>
			<SessionWatcher onLeftGroup={onLeftGroup} />
		</QueryClientProvider>,
	);
	return queryClient;
}

beforeEach(async () => {
	vi.stubGlobal("fetch", fetchMock);
	vi.mocked(login).mockResolvedValueOnce({ token: "velho", user });
	await startSession();
});

afterEach(() => {
	clearSession();
	fetchMock.mockReset();
	vi.mocked(login).mockReset();
	vi.unstubAllGlobals();
});

describe("SessionWatcher", () => {
	it("um 401 faz o login de novo e repete a chamada com o token novo", async () => {
		renderWatcher(vi.fn());
		vi.mocked(login).mockResolvedValueOnce({ token: "novo", user });
		fetchMock
			.mockResolvedValueOnce(
				json(401, { kind: "unauthenticated", message: "Entre de novo." }),
			)
			.mockResolvedValueOnce(json(200, {}));

		await apiFetch("/api/me");

		expect(login).toHaveBeenCalledTimes(2);
		expect(
			new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization"),
		).toBe("Bearer novo");
	});

	it("saiu do grupo: limpa o cache e navega", async () => {
		const onLeftGroup = vi.fn();
		const queryClient = renderWatcher(onLeftGroup);
		vi.mocked(login).mockRejectedValueOnce(
			new ApiError({ status: 401, kind: "unknown_device", message: "Saiu." }),
		);
		fetchMock.mockResolvedValue(
			json(401, { kind: "unauthenticated", message: "Entre de novo." }),
		);

		await expect(apiFetch("/api/me")).rejects.toMatchObject({
			kind: "unknown_device",
		});

		expect(onLeftGroup).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryData(identityKeys.me())).toBeUndefined();
		expect(useSessionStore.getState().session).toEqual({
			status: "leftGroup",
			account: { nick: "kid", display_name: null },
		});
	});
});

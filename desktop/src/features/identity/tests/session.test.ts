import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, clearSession, type UserView } from "@/lib/api";
import { accountMarker, login, redeem } from "@/lib/tauri/commands";
import {
	reauthenticate,
	redeemInvite,
	setLeftGroup,
	startSession,
	useSessionStore,
} from "../session";

vi.mock("@/lib/tauri/commands", () => ({
	login: vi.fn(),
	redeem: vi.fn(),
	accountMarker: vi.fn(),
	checkForUpdate: vi.fn(() => Promise.resolve()),
}));

const user: UserView = {
	id: "u1",
	nick: "kid",
	display_name: "Kid",
	is_owner: true,
};

function refused(status: number, kind: ApiError["kind"]) {
	return new ApiError({ status, kind, message: kind });
}

/** O `Authorization` que o `apiFetch` manda agora: confere o token guardado no `lib/api`. */
async function sentToken(): Promise<string | null> {
	const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
	vi.stubGlobal("fetch", fetchMock);
	await apiFetch("/api/me");
	vi.unstubAllGlobals();
	return new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization");
}

const session = () => useSessionStore.getState().session;

beforeEach(() => {
	useSessionStore.setState({ session: { status: "entering" } });
});

afterEach(() => {
	clearSession();
	vi.mocked(login).mockReset();
	vi.mocked(redeem).mockReset();
	vi.mocked(accountMarker).mockReset();
});

describe("startSession", () => {
	it("o login certo guarda o token e conecta", async () => {
		vi.mocked(login).mockResolvedValue({ token: "tok", user });

		await startSession();

		expect(session()).toEqual({ status: "connected", user });
		expect(await sentToken()).toBe("Bearer tok");
	});

	it("unknown_device sem marcador: nunca entrou", async () => {
		vi.mocked(login).mockRejectedValue(refused(401, "unknown_device"));
		vi.mocked(accountMarker).mockResolvedValue(null);

		await startSession();

		expect(session()).toEqual({ status: "noAccount" });
	});

	it("unknown_device com marcador: saiu do grupo, com a conta que era daqui", async () => {
		vi.mocked(login).mockRejectedValue(refused(401, "unknown_device"));
		vi.mocked(accountMarker).mockResolvedValue({
			nick: "kid",
			display_name: null,
		});

		await startSession();

		expect(session()).toEqual({
			status: "leftGroup",
			account: { nick: "kid", display_name: null },
		});
	});

	it("outro erro fica na sessão com o kind, e não tenta de novo sozinho", async () => {
		vi.mocked(login).mockRejectedValue(refused(0, "network"));

		await startSession();

		const current = session();
		expect(current.status).toBe("error");
		expect(current.status === "error" && current.error.kind).toBe("network");
		expect(login).toHaveBeenCalledTimes(1);
		expect(await sentToken()).toBeNull();
	});

	it("duas chamadas juntas fazem um login só", async () => {
		vi.mocked(login).mockResolvedValue({ token: "tok", user });

		await Promise.all([startSession(), startSession()]);

		expect(login).toHaveBeenCalledTimes(1);
	});
});

describe("redeemInvite", () => {
	it("o convite certo conecta com a conta nova", async () => {
		vi.mocked(redeem).mockResolvedValue({ token: "novo", user });

		await expect(redeemInvite("7KQ2M9XD4HPA", "kid")).resolves.toEqual(user);

		expect(redeem).toHaveBeenCalledWith("7KQ2M9XD4HPA", "kid");
		expect(session()).toEqual({ status: "connected", user });
		expect(await sentToken()).toBe("Bearer novo");
	});

	it("device_already_linked faz o login e rejeita com o mesmo erro", async () => {
		vi.mocked(redeem).mockRejectedValue(refused(409, "device_already_linked"));
		vi.mocked(login).mockResolvedValue({ token: "tok", user });

		await expect(redeemInvite("7KQ2M9XD4HPA", "kid")).rejects.toMatchObject({
			kind: "device_already_linked",
		});
		expect(session()).toEqual({ status: "connected", user });
	});

	it("um erro de regra não muda a sessão", async () => {
		vi.mocked(redeem).mockRejectedValue(refused(409, "nick_taken"));

		await expect(redeemInvite("7KQ2M9XD4HPA", "kid")).rejects.toMatchObject({
			kind: "nick_taken",
		});
		expect(session()).toEqual({ status: "entering" });
		expect(login).not.toHaveBeenCalled();
	});
});

describe("o 401 no meio do uso", () => {
	it("reauthenticate troca o token sem passar por Entrando", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(login).mockResolvedValue({ token: "outro", user });

		await reauthenticate();

		expect(session()).toEqual({ status: "connected", user });
		expect(await sentToken()).toBe("Bearer outro");
	});

	it("setLeftGroup guarda de quem era a conta e esquece o token", async () => {
		vi.mocked(login).mockResolvedValue({ token: "tok", user });
		await startSession();

		setLeftGroup();

		expect(session()).toEqual({
			status: "leftGroup",
			account: { nick: "kid", display_name: "Kid" },
		});
		expect(await sentToken()).toBeNull();
	});
});

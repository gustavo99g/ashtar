import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "@/lib/tauri/commands";
import { apiFetch } from "../client";
import { ApiError, isRetryable } from "../errors";
import { clearSession, setSessionHandlers, setSessionToken } from "../session";

// O 426 pede uma verificação de atualização ao Rust; aqui só conta a chamada.
vi.mock("@/lib/tauri/commands", () => ({
	checkForUpdate: vi.fn(() => Promise.resolve()),
}));

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const unauthenticated = () =>
	json(401, {
		kind: "unauthenticated",
		message: "Sessão inválida. Entre de novo.",
	});

/** O cabeçalho `Authorization` da chamada número `call` ao `fetch`. */
function authorization(call: number): string | null {
	return new Headers(fetchMock.mock.calls[call][1]?.headers).get(
		"Authorization",
	);
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
	const error = await promise.catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(ApiError);
	return error as ApiError;
}

let unregister = () => {};

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	unregister();
	clearSession();
	fetchMock.mockReset();
	vi.mocked(checkForUpdate).mockClear();
	vi.unstubAllGlobals();
});

describe("apiFetch: erros", () => {
	it("sem resposta vira network, com status 0, e vale tentar de novo", async () => {
		fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

		const error = await rejection(apiFetch("/api/me"));
		expect(error.kind).toBe("network");
		expect(error.status).toBe(0);
		expect(isRetryable(error)).toBe(true);
	});

	it("o fim do tempo vira timeout", async () => {
		fetchMock.mockRejectedValue(new DOMException("demorou", "TimeoutError"));

		const error = await rejection(apiFetch("/api/me"));
		expect(error.kind).toBe("timeout");
		expect(isRetryable(error)).toBe(true);
	});

	it("lê o kind e a mensagem do corpo, e um erro de regra não se repete", async () => {
		fetchMock.mockResolvedValue(
			json(409, { kind: "nick_taken", message: "Esse nick já está em uso." }),
		);

		const error = await rejection(
			apiFetch("/api/auth/redeem", { method: "POST" }),
		);
		expect(error.status).toBe(409);
		expect(error.kind).toBe("nick_taken");
		expect(error.message).toBe("Esse nick já está em uso.");
		expect(isRetryable(error)).toBe(false);
	});

	it("o 426 traz a versão mínima e pede uma verificação de atualização", async () => {
		fetchMock.mockResolvedValue(
			json(426, {
				kind: "client_outdated",
				message: "Atualize.",
				min_version: "0.2.20",
			}),
		);

		const error = await rejection(apiFetch("/api/me"));
		expect(error.kind).toBe("client_outdated");
		expect(error.minVersion).toBe("0.2.20");
		expect(checkForUpdate).toHaveBeenCalledOnce();
	});

	it("uma resposta sem o corpo da API vira http, e um 5xx vale tentar de novo", async () => {
		fetchMock.mockResolvedValue(
			new Response("<html>Bad Gateway</html>", { status: 502 }),
		);

		const error = await rejection(apiFetch("/api/me"));
		expect(error.kind).toBe("http");
		expect(error.status).toBe(502);
		expect(isRetryable(error)).toBe(true);
	});
});

describe("apiFetch: sessão", () => {
	it("manda a versão e, com sessão, o token", async () => {
		fetchMock.mockResolvedValue(json(200, {}));

		await apiFetch("/api/me");
		expect(authorization(0)).toBeNull();

		setSessionToken("abc");
		await apiFetch("/api/me");
		expect(authorization(1)).toBe("Bearer abc");
		expect(
			new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-App-Version"),
		).toBe(__APP_VERSION__);
	});

	it("um 401 faz o login uma vez e repete a chamada com o token novo", async () => {
		setSessionToken("velho");
		const reauthenticate = vi.fn(async () => setSessionToken("novo"));
		unregister = setSessionHandlers({ reauthenticate, onLeftGroup: vi.fn() });
		fetchMock
			.mockResolvedValueOnce(unauthenticated())
			.mockResolvedValueOnce(json(200, { ok: true }));

		const response = await apiFetch("/api/me");
		expect(await response.json()).toEqual({ ok: true });
		expect(reauthenticate).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(authorization(1)).toBe("Bearer novo");
	});

	it("um segundo 401 depois do login novo desiste, sem laço", async () => {
		setSessionToken("velho");
		const reauthenticate = vi.fn(async () => setSessionToken("novo"));
		unregister = setSessionHandlers({ reauthenticate, onLeftGroup: vi.fn() });
		fetchMock.mockImplementation(async () => unauthenticated());

		const error = await rejection(apiFetch("/api/me"));
		expect(error.kind).toBe("unauthenticated");
		expect(reauthenticate).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("unknown_device no login avisa que saiu do grupo uma vez e limpa a sessão", async () => {
		setSessionToken("velho");
		const onLeftGroup = vi.fn();
		const reauthenticate = vi.fn(async () => {
			throw new ApiError({
				status: 401,
				kind: "unknown_device",
				message: "Saiu.",
			});
		});
		unregister = setSessionHandlers({ reauthenticate, onLeftGroup });
		fetchMock.mockImplementation(async () => unauthenticated());

		const errors = await Promise.all([
			rejection(apiFetch("/api/me")),
			rejection(apiFetch("/api/members")),
		]);
		expect(errors.map((error) => error.kind)).toEqual([
			"unknown_device",
			"unknown_device",
		]);
		expect(reauthenticate).toHaveBeenCalledOnce();
		expect(onLeftGroup).toHaveBeenCalledOnce();

		// Sem sessão, o próximo 401 não tenta de novo.
		const next = await rejection(apiFetch("/api/me"));
		expect(next.kind).toBe("unauthenticated");
		expect(reauthenticate).toHaveBeenCalledOnce();
	});

	it("vários 401 juntos esperam o mesmo login", async () => {
		setSessionToken("velho");
		const reauthenticate = vi.fn(async () => setSessionToken("novo"));
		unregister = setSessionHandlers({ reauthenticate, onLeftGroup: vi.fn() });
		fetchMock.mockImplementation(async (_url, init) =>
			new Headers(init?.headers).get("Authorization") === "Bearer novo"
				? json(200, {})
				: unauthenticated(),
		);

		await Promise.all([
			apiFetch("/api/me"),
			apiFetch("/api/members"),
			apiFetch("/api/invites"),
		]);
		expect(reauthenticate).toHaveBeenCalledOnce();
	});

	it("o 401 do código de acesso e o 401 sem sessão não fazem login", async () => {
		const reauthenticate = vi.fn(async () => setSessionToken("novo"));
		unregister = setSessionHandlers({ reauthenticate, onLeftGroup: vi.fn() });

		fetchMock.mockResolvedValueOnce(unauthenticated());
		expect((await rejection(apiFetch("/api/me"))).kind).toBe("unauthenticated");

		setSessionToken("abc");
		fetchMock.mockResolvedValueOnce(
			json(401, { kind: "access_denied", message: "Recusado." }),
		);
		expect((await rejection(apiFetch("/api/me"))).kind).toBe("access_denied");

		expect(reauthenticate).not.toHaveBeenCalled();
	});
});

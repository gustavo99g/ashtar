import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, isRetryable } from "@/lib/api";
import { accountMarker, login, redeem } from "../commands";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));

const session = {
	token: "tok",
	user: { id: "u1", nick: "kid", display_name: null, is_owner: true },
};

beforeEach(() => {
	invoke.mockReset();
});

describe("login e redeem", () => {
	it("devolvem a sessão do Rust", async () => {
		invoke.mockResolvedValue(session);

		await expect(login()).resolves.toEqual(session);
		expect(invoke).toHaveBeenCalledWith("login", undefined);

		await redeem("7KQ2M9XD", "kid");
		expect(invoke).toHaveBeenLastCalledWith("redeem", {
			code: "7KQ2M9XD",
			nick: "kid",
		});
	});

	it("a recusa vira o ApiError com o kind da API", async () => {
		invoke.mockRejectedValue({
			status: 401,
			kind: "unknown_device",
			message: "Sem conta.",
		});

		const error = await login().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			status: 401,
			kind: "unknown_device",
			message: "Sem conta.",
		});
		expect(isRetryable(error)).toBe(false);
	});

	it("sem rede é o mesmo erro do apiFetch, que pode tentar de novo", async () => {
		invoke.mockRejectedValue({
			status: 0,
			kind: "network",
			message: "Sem rede.",
		});

		const error = await login().catch((caught: unknown) => caught);
		expect(error).toMatchObject({ status: 0, kind: "network" });
		expect(isRetryable(error)).toBe(true);
	});

	it("o 426 traz a versão mínima e pede a verificação da atualização", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "check_for_update") return undefined;
			throw {
				status: 426,
				kind: "client_outdated",
				message: "Atualize.",
				min_version: "0.2.2",
			};
		});

		const error = await redeem("7KQ2M9XD", null).catch(
			(caught: unknown) => caught,
		);
		expect(error).toMatchObject({
			kind: "client_outdated",
			minVersion: "0.2.2",
		});
		expect(invoke).toHaveBeenCalledWith("check_for_update", undefined);
	});

	it("o marcador não passa pelo ApiError: é um comando local", async () => {
		invoke.mockResolvedValue({ nick: "kid", display_name: null });
		await expect(accountMarker()).resolves.toEqual({
			nick: "kid",
			display_name: null,
		});
		expect(invoke).toHaveBeenCalledWith("account_marker", undefined);
	});

	it("um erro do próprio Tauri vira kind app", async () => {
		invoke.mockRejectedValue("command login not found");

		const error = await login().catch((caught: unknown) => caught);
		expect(error).toMatchObject({ status: 0, kind: "app" });
	});
});

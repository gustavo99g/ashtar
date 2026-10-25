import { describe, expect, it } from "vitest";
import { ApiError, type ApiErrorKind } from "@/lib/api";
import { shouldRetry } from "../queryClient";

function error(status: number, kind: ApiErrorKind) {
	return new ApiError({ status, kind, message: "" });
}

describe("shouldRetry", () => {
	it("tenta de novo até 2 vezes sem resposta, no fim do tempo e no 5xx", () => {
		const failures = [
			error(0, "network"),
			error(0, "timeout"),
			error(500, "internal"),
			error(502, "http"),
		];
		for (const failure of failures) {
			expect(shouldRetry(0, failure)).toBe(true);
			expect(shouldRetry(1, failure)).toBe(true);
			expect(shouldRetry(2, failure)).toBe(false);
		}
	});

	it("não tenta de novo um erro de regra", () => {
		const kinds: [number, ApiErrorKind][] = [
			[426, "client_outdated"],
			[403, "forbidden"],
			[400, "invalid_invite"],
			[401, "unauthenticated"],
			[401, "unknown_device"],
			[429, "too_many_attempts"],
			[0, "device_key"],
		];
		for (const [status, kind] of kinds) {
			expect(shouldRetry(0, error(status, kind))).toBe(false);
		}
	});

	it("não tenta de novo um erro que não é da API", () => {
		expect(shouldRetry(0, new Error("bug"))).toBe(false);
	});
});

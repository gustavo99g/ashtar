import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { shouldRetry } from "@/lib/query";
import { useInvitePreview } from "../queries";

const { getInvite } = vi.hoisted(() => ({ getInvite: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getInvite,
}));

/** Um cliente por teste, criado uma vez: um cliente novo a cada render refaria a busca. */
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	getInvite.mockReset();
	// As mesmas regras do app (`lib/query`), para o teste valer como o app de verdade.
	client = new QueryClient({
		defaultOptions: { queries: { retry: shouldRetry, staleTime: 30_000 } },
	});
});

describe("useInvitePreview", () => {
	it("um convite que não vale não é buscado de novo ao voltar o foco da janela", async () => {
		getInvite.mockRejectedValue(
			new ApiError({
				status: 400,
				kind: "invalid_invite",
				message: "Convite inválido.",
			}),
		);

		const { result } = renderHook(() => useInvitePreview("ABCD-EFGH-JK00"), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isError).toBe(true));

		window.dispatchEvent(new Event("focus"));
		window.dispatchEvent(new Event("visibilitychange"));
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Cada falha conta no limite de tentativas da API, que é um só para todos.
		expect(getInvite).toHaveBeenCalledTimes(1);
	});

	it("sem código, não chama a API", () => {
		renderHook(() => useInvitePreview(null), { wrapper });

		expect(getInvite).not.toHaveBeenCalled();
	});
});

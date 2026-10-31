import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type CreatedInviteView, createInvite } from "@/lib/api";
import { InvitesSettings } from "../InvitesSettings";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createInvite: vi.fn(),
}));

const created: CreatedInviteView = {
	id: "i1",
	code: "7KQ2-M9XD-4HPA",
	link: "https://ashtar.exemplo.ts.net/invite/7KQ2-M9XD-4HPA",
	expires_at: Math.floor(Date.now() / 1000) + 7 * 86_400,
	max_uses: 1,
	preset: "person",
};

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<InvitesSettings />
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.mocked(createInvite).mockReset();
});

describe("InvitesSettings: novo convite", () => {
	it("cria pelo modelo e mostra o código no bilhete", async () => {
		vi.mocked(createInvite).mockResolvedValue(created);
		const user = userEvent.setup();
		renderPage();

		await user.click(screen.getByRole("button", { name: "Criar convite" }));

		expect(createInvite).toHaveBeenCalledWith({ preset: "person" });
		expect(await screen.findByText("7KQ2-M9XD-4HPA")).toBeInTheDocument();
		expect(screen.getByText("Convite para uma pessoa")).toBeInTheDocument();

		await user.click(
			screen.getByRole("button", { name: "Criar outro convite" }),
		);
		expect(screen.queryByText("7KQ2-M9XD-4HPA")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Criar convite" }),
		).toBeInTheDocument();
	});

	it("no Do seu jeito, manda a validade e as pessoas", async () => {
		vi.mocked(createInvite).mockResolvedValue({
			...created,
			preset: "custom",
			max_uses: 6,
		});
		const user = userEvent.setup();
		renderPage();

		await user.click(screen.getByRole("radio", { name: /Do seu jeito/ }));
		await user.click(screen.getByRole("radio", { name: "7 dias" }));
		await user.click(screen.getByRole("button", { name: "Mais pessoas" }));
		await user.click(screen.getByRole("button", { name: "Mais pessoas" }));
		await user.click(screen.getByRole("button", { name: "Criar convite" }));

		expect(createInvite).toHaveBeenCalledWith({
			preset: "custom",
			ttl_secs: 7 * 86_400,
			max_uses: 6,
		});
		expect(
			await screen.findByText("Convite para 6 pessoas"),
		).toBeInTheDocument();
	});

	it("mostra o erro no lugar do rodapé", async () => {
		vi.mocked(createInvite).mockRejectedValue(
			new ApiError({ status: 500, kind: "internal", message: "Erro interno." }),
		);
		const user = userEvent.setup();
		renderPage();

		await user.click(screen.getByRole("button", { name: "Criar convite" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Não deu para criar o convite. Tente de novo.",
		);
		expect(
			screen.getByRole("button", { name: "Tentar de novo" }),
		).toBeInTheDocument();
	});
});

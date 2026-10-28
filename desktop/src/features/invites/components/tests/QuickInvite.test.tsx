import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CreatedInviteView, createInvite } from "@/lib/api";
import { forgetQuickInvite } from "../../quickInvite";
import { QuickInvite } from "../QuickInvite";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createInvite: vi.fn(),
}));

const invite: CreatedInviteView = {
	id: "i1",
	code: "7KQ2-M9XD-4HPA",
	link: "https://ashtar.exemplo.ts.net/invite/7KQ2-M9XD-4HPA",
	expires_at: Math.floor(Date.now() / 1000) + 300,
	max_uses: 8,
	preset: "group",
};

function renderQuickInvite() {
	const client = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<QuickInvite canViewPanel />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.mocked(createInvite).mockReset();
	forgetQuickInvite();
});

describe("QuickInvite", () => {
	it("cria um convite para o grupo na primeira vez e mostra o mesmo depois", async () => {
		vi.mocked(createInvite).mockResolvedValue(invite);
		const user = userEvent.setup();
		renderQuickInvite();

		await user.click(screen.getByRole("button", { name: "Convidar" }));
		expect(await screen.findByText("7KQ2-M9XD-4HPA")).toBeInTheDocument();
		expect(createInvite).toHaveBeenCalledWith({ preset: "group" });

		await user.click(screen.getByRole("button", { name: "Fechar" }));
		await user.click(screen.getByRole("button", { name: "Convidar" }));

		expect(await screen.findByText("7KQ2-M9XD-4HPA")).toBeInTheDocument();
		expect(createInvite).toHaveBeenCalledTimes(1);
	});

	it("copia o link", async () => {
		vi.mocked(createInvite).mockResolvedValue(invite);
		const user = userEvent.setup();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		renderQuickInvite();

		await user.click(screen.getByRole("button", { name: "Convidar" }));
		await user.click(
			await screen.findByRole("button", { name: "Copiar link" }),
		);

		expect(writeText).toHaveBeenCalledWith(invite.link);
		expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument();
	});
});

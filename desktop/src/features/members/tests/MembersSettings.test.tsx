import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { listMembers, setMemberBeta } from "@/lib/api";
import { MembersSettings } from "../components/MembersSettings";
import { member, NOW, owner } from "./testMembers";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listMembers: vi.fn(),
	setMemberBeta: vi.fn(),
}));

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<MembersSettings />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	useSessionStore.setState({
		session: {
			status: "connected",
			user: { id: "kid", nick: "kid", display_name: null, is_owner: true },
		},
	});
});

afterEach(() => {
	vi.mocked(listMembers).mockReset();
	vi.mocked(setMemberBeta).mockReset();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("MembersSettings", () => {
	it("filtra pelos chips sem chamar a API de novo", async () => {
		vi.mocked(listMembers).mockResolvedValue([
			owner,
			member("juliana", { display_name: "juju" }),
			member("bruno.s", {
				display_name: "bruno",
				removed_at: NOW - 86_400,
				device: null,
			}),
		]);
		const user = userEvent.setup();
		renderPage();

		const list = await screen.findByRole("list", { name: "Membros" });
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);

		await user.click(screen.getByRole("radio", { name: /Removidos/ }));

		expect(within(list).getAllByRole("listitem")).toHaveLength(1);
		expect(within(list).getByText("bruno")).toBeInTheDocument();
		expect(listMembers).toHaveBeenCalledTimes(1);
	});

	it("liga o beta na hora e deixa o do dono travado", async () => {
		const juliana = member("juliana", { display_name: "juju" });
		vi.mocked(listMembers)
			.mockResolvedValueOnce([owner, juliana])
			.mockResolvedValue([
				owner,
				{ ...juliana, beta: { origin: "direct", granted_at: NOW } },
			]);
		vi.mocked(setMemberBeta).mockResolvedValue();
		const user = userEvent.setup();
		renderPage();

		const ownerSwitch = await screen.findByRole("switch", {
			name: "O dono sempre recebe o beta",
		});
		expect(ownerSwitch).toBeChecked();
		expect(ownerSwitch).toHaveAttribute("aria-disabled", "true");

		const juju = screen.getByRole("switch", { name: "Beta para juju" });
		await user.click(juju);

		expect(juju).toBeChecked();
		expect(setMemberBeta).toHaveBeenCalledWith("juliana", true);
	});

	it("mostra o primeiro uso quando só o dono está no grupo", async () => {
		vi.mocked(listMembers).mockResolvedValue([owner]);
		renderPage();

		expect(await screen.findByText("Só você por aqui")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Criar o primeiro convite" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("radiogroup", { name: "Filtrar membros" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Convidar alguém" }),
		).not.toBeInTheDocument();
	});
});

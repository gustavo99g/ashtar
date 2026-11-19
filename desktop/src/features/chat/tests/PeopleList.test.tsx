import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { listPeople, listVoiceParticipants, type UserView } from "@/lib/api";
import { PeopleList } from "../components/PeopleList";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listPeople: vi.fn(),
	listVoiceParticipants: vi.fn(),
}));

const kid: UserView = {
	id: "u1",
	nick: "kid",
	display_name: "Kid",
	is_owner: true,
};

function renderPeople() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<PeopleList />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	vi.mocked(listPeople).mockResolvedValue([
		{
			id: "u1",
			nick: "kid",
			display_name: "Kid",
			is_owner: true,
			online: true,
			status: "available",
		},
		{
			id: "u2",
			nick: "ana",
			display_name: null,
			is_owner: false,
			online: true,
			status: "available",
		},
		{
			id: "u3",
			nick: "bia",
			display_name: null,
			is_owner: false,
			online: false,
			status: "available",
		},
	]);
	vi.mocked(listVoiceParticipants).mockResolvedValue([
		{ user_id: "u1", nick: "kid", display_name: "Kid", screen_sharing: false },
	]);
});

describe("PeopleList", () => {
	it("separa o dono, o resto de quem está online e quem está offline", async () => {
		renderPeople();
		// O dono online fica sozinho em cima, com a coroa; o resto de quem está online vem abaixo;
		// o Offline segue como estava.
		const owner = await screen.findByRole("region", { name: "Dono" });
		expect(within(owner).getByText("Kid")).toBeInTheDocument();
		expect(await within(owner).findByText("Na Sala")).toBeInTheDocument();
		expect(within(owner).queryByText("ana")).not.toBeInTheDocument();
		const rest = screen.getByRole("region", { name: "Resto" });
		expect(within(rest).getByText("ana")).toBeInTheDocument();
		expect(within(rest).queryByText("Kid")).not.toBeInTheDocument();
		expect(within(rest).getByRole("heading")).toHaveTextContent("Resto — 1");
		const offline = screen.getByRole("region", { name: "Offline" });
		expect(within(offline).getByText("bia")).toBeInTheDocument();
		// Quem está offline fica apagado, com o avatar e o nome juntos; quem está online, não.
		expect(within(offline).getByText("bia").closest("button")).toHaveClass(
			"opacity-50",
		);
		expect(within(rest).getByText("ana").closest("button")).not.toHaveClass(
			"opacity-50",
		);
		expect(within(owner).getByText("Kid").closest("button")).not.toHaveClass(
			"opacity-50",
		);
	});

	it("clicar em alguém na lista de membros abre o cartão da pessoa", async () => {
		const user = userEvent.setup();
		renderPeople();
		const owner = await screen.findByRole("region", { name: "Dono" });
		await within(owner).findByText("Na Sala");

		await user.click(within(owner).getByRole("button", { name: /Kid/ }));

		const card = await screen.findByRole("dialog", { name: "Perfil de Kid" });
		expect(within(card).getByText("kid")).toBeVisible();
		expect(within(card).getByText("Na Sala")).toBeVisible();

		// Quem está offline também abre, e o cartão diz isso.
		await user.keyboard("{Escape}");
		const offline = screen.getByRole("region", { name: /^Offline/ });
		await user.click(within(offline).getByRole("button", { name: /bia/ }));

		const other = await screen.findByRole("dialog", { name: "Perfil de bia" });
		expect(within(other).getByText("Offline")).toBeVisible();
	});

	it("o dono fica sempre no topo, mesmo offline", async () => {
		vi.mocked(listPeople).mockResolvedValue([
			{
				id: "u1",
				nick: "kid",
				display_name: "Kid",
				is_owner: true,
				online: false,
				status: "available",
			},
			{
				id: "u2",
				nick: "ana",
				display_name: null,
				is_owner: false,
				online: true,
				status: "available",
			},
		]);
		renderPeople();
		const owner = await screen.findByRole("region", { name: "Dono" });
		expect(within(owner).getByText("Kid")).toBeInTheDocument();
		// O dono offline continua no topo, só que apagado, com as cores de sempre.
		expect(within(owner).getByText("Kid").closest("button")).toHaveClass(
			"opacity-50",
		);
		const rest = screen.getByRole("region", { name: "Resto" });
		expect(within(rest).getByText("ana")).toBeInTheDocument();
		// Sem ninguém offline além do dono, o grupo Offline nem aparece.
		expect(
			screen.queryByRole("region", { name: "Offline" }),
		).not.toBeInTheDocument();
		// A ordem na coluna: Dono, Resto.
		const regions = screen
			.getAllByRole("region")
			.map((region) => region.getAttribute("aria-label"));
		expect(regions.indexOf("Dono")).toBeLessThan(regions.indexOf("Resto"));
	});
});

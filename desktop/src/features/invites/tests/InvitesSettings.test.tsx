import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import {
	ApiError,
	type CreatedInviteView,
	createInvite,
	type InviteView,
	listInvites,
	revokeInvite,
} from "@/lib/api";
import { InvitesSettings } from "../components/InvitesSettings";
import { rememberQuickInvite, useQuickInviteStore } from "../stores/quickInviteStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createInvite: vi.fn(),
	listInvites: vi.fn(),
	revokeInvite: vi.fn(),
}));

const created: CreatedInviteView = {
	id: "i1",
	code: "7KQ2-M9XD-4HPA",
	link: "https://ashtar.exemplo.ts.net/invite/7KQ2-M9XD-4HPA",
	expires_at: Math.floor(Date.now() / 1000) + 7 * 86_400,
	max_uses: 1,
	preset: "person",
};

const now = Math.floor(Date.now() / 1000);
const kid = { id: "u-kid", nick: "kid", display_name: null };

function invite(id: string, fields: Partial<InviteView> = {}): InviteView {
	return {
		id,
		kind: "new",
		preset: "person",
		status: "pending",
		created_by: kid,
		target: null,
		created_at: now - 86_400,
		expires_at: now + 5 * 86_400,
		revoked_at: null,
		max_uses: 1,
		uses: [],
		...fields,
	};
}

function renderPage() {
	useSessionStore.setState({
		session: { status: "connected", user: { ...kid, is_owner: true } },
	});
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
	vi.mocked(listInvites).mockReset();
	vi.mocked(revokeInvite).mockReset();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("InvitesSettings: novo convite", () => {
	it("cria pelo modelo e mostra o código no bilhete", async () => {
		vi.mocked(listInvites).mockResolvedValue([]);
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
		vi.mocked(listInvites).mockResolvedValue([]);
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
		vi.mocked(listInvites).mockResolvedValue([]);
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

describe("InvitesSettings: histórico", () => {
	it("mostra o vazio antes do primeiro convite", async () => {
		vi.mocked(listInvites).mockResolvedValue([]);
		renderPage();

		expect(await screen.findByText("Nenhum convite ainda")).toBeInTheDocument();
	});

	it("filtra os que valem sem chamar a API de novo", async () => {
		vi.mocked(listInvites).mockResolvedValue([
			invite("i1"),
			invite("i2", { status: "revoked", revoked_at: now - 3600 }),
		]);
		const user = userEvent.setup();
		renderPage();

		const list = await screen.findByRole("list");
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);

		await user.click(screen.getByRole("radio", { name: /Valendo/ }));

		expect(
			within(screen.getByRole("list")).getAllByRole("listitem"),
		).toHaveLength(1);
		expect(listInvites).toHaveBeenCalledTimes(1);
	});

	it("revoga depois de confirmar na linha e esquece o convite rápido", async () => {
		vi.mocked(listInvites).mockResolvedValue([invite("i1")]);
		vi.mocked(revokeInvite).mockResolvedValue();
		rememberQuickInvite({ ...created, id: "i1" });
		const user = userEvent.setup();
		renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Revogar Para uma pessoa" }),
		);
		expect(revokeInvite).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Revogar" }));

		expect(revokeInvite).toHaveBeenCalledWith("i1");
		await vi.waitFor(() =>
			expect(useQuickInviteStore.getState().current).toBeNull(),
		);
	});

	it("deixa tentar de novo quando a revogação falha por outro motivo", async () => {
		vi.mocked(listInvites).mockResolvedValue([invite("i1")]);
		vi.mocked(revokeInvite).mockRejectedValueOnce(
			new ApiError({ status: 500, kind: "internal", message: "Deu ruim." }),
		);
		vi.mocked(revokeInvite).mockResolvedValue();
		const user = userEvent.setup();
		renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Revogar Para uma pessoa" }),
		);
		await user.click(screen.getByRole("button", { name: "Revogar" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Não deu para revogar.",
		);

		await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
		await user.click(
			await screen.findByRole("button", { name: "Revogar Para uma pessoa" }),
		);
		await user.click(screen.getByRole("button", { name: "Revogar" }));

		await waitFor(() => expect(revokeInvite).toHaveBeenCalledTimes(2));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("diz que o convite já não valia quando a API responde 409", async () => {
		vi.mocked(listInvites).mockResolvedValue([invite("i1")]);
		vi.mocked(revokeInvite).mockRejectedValue(
			new ApiError({
				status: 409,
				kind: "conflict",
				message: "Esse convite já não vale.",
			}),
		);
		const user = userEvent.setup();
		renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Revogar Para uma pessoa" }),
		);
		await user.click(screen.getByRole("button", { name: "Revogar" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Esse convite já foi usado ou venceu",
		);
	});
});

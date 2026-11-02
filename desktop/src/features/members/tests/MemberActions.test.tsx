import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import {
	ApiError,
	type CreatedInviteView,
	createRecoveryInvite,
	type GrantView,
	getMe,
	getMemberPermissions,
	listMembers,
	removeMember,
	setMemberPermission,
	unlinkMember,
} from "@/lib/api";
import { MembersSettings } from "../components/MembersSettings";
import { member, NOW, owner } from "./testMembers";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getMe: vi.fn(),
	listMembers: vi.fn(),
	getMemberPermissions: vi.fn(),
	unlinkMember: vi.fn(),
	createRecoveryInvite: vi.fn(),
	removeMember: vi.fn(),
	setMemberPermission: vi.fn(),
}));

const juju = member("juliana", { display_name: "juju" });

const recovery: CreatedInviteView = {
	id: "r1",
	code: "3RTW-8NB5-QZ6C",
	link: "https://ashtar.exemplo.ts.net/recovery/3RTW-8NB5-QZ6C",
	expires_at: NOW + 7 * 86_400,
	max_uses: 1,
	preset: null,
};

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

async function openMenu(
	user: ReturnType<typeof userEvent.setup>,
	name: string,
) {
	await user.click(
		await screen.findByRole("button", { name: `Mais ações para ${name}` }),
	);
}

beforeEach(() => {
	const kid = { id: "kid", nick: "kid", display_name: null, is_owner: true };
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	vi.mocked(getMe).mockResolvedValue({
		user: kid,
		permissions: [],
		update_channel: "beta",
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: true,
	});
	vi.mocked(listMembers).mockResolvedValue([owner, juju]);
});

afterEach(() => {
	vi.clearAllMocks();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("ações do membro", () => {
	it("a gaveta mostra as permissões que a API devolve", async () => {
		const grants: GrantView[] = [
			{
				key: "atualizacoes.beta",
				kind: "permission",
				label: "Receber o beta",
				granted: false,
				origin: null,
				granted_at: null,
			},
			{
				key: "nova.acao",
				kind: "action",
				label: "Uma ação que a API acabou de criar",
				granted: false,
				origin: null,
				granted_at: null,
			},
		];
		vi.mocked(getMemberPermissions).mockResolvedValue(grants);
		const user = userEvent.setup();
		renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Detalhes de juju" }),
		);

		expect(
			await screen.findByText("Uma ação que a API acabou de criar"),
		).toBeInTheDocument();
		// A permissão vira uma chave; a ação continua só com o selo.
		expect(
			screen.getByRole("switch", { name: "Receber o beta para juju" }),
		).not.toBeChecked();
		expect(screen.getByText("Só o dono")).toBeInTheDocument();
		expect(getMemberPermissions).toHaveBeenCalledWith("juliana");
	});

	it("a chave de Gerenciar canais liga a permissão na hora", async () => {
		const off: GrantView = {
			key: "canais.gerenciar",
			kind: "permission",
			label: "Gerenciar canais",
			granted: false,
			origin: null,
			granted_at: null,
		};
		vi.mocked(getMemberPermissions)
			.mockResolvedValueOnce([off])
			.mockResolvedValue([
				{ ...off, granted: true, origin: "direct", granted_at: NOW },
			]);
		vi.mocked(setMemberPermission).mockResolvedValue();
		const user = userEvent.setup();
		renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Detalhes de juju" }),
		);
		const toggle = await screen.findByRole("switch", {
			name: "Gerenciar canais para juju",
		});
		await user.click(toggle);

		expect(toggle).toBeChecked();
		expect(setMemberPermission).toHaveBeenCalledWith(
			"juliana",
			"canais.gerenciar",
			true,
		);
	});

	it("no dono não tem chave: só o selo", async () => {
		vi.mocked(getMemberPermissions).mockResolvedValue([
			{
				key: "canais.gerenciar",
				kind: "permission",
				label: "Gerenciar canais",
				granted: true,
				origin: "owner",
				granted_at: null,
			},
		]);
		const user = userEvent.setup();
		renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Detalhes de kid" }),
		);

		expect(await screen.findByText("Gerenciar canais")).toBeInTheDocument();
		expect(
			screen.queryByRole("switch", { name: /Gerenciar canais/ }),
		).toBeNull();
		const list = screen.getByRole("list", { name: "Permissões" });
		expect(within(list).getByText("Dono")).toBeInTheDocument();
	});

	it("desvincula e já cria a recuperação, nas duas chamadas em sequência", async () => {
		vi.mocked(unlinkMember).mockResolvedValue();
		vi.mocked(createRecoveryInvite).mockResolvedValue(recovery);
		const user = userEvent.setup();
		renderPage();

		await openMenu(user, "juju");
		await user.click(
			await screen.findByRole("menuitem", { name: "Desvincular computador" }),
		);
		expect(
			screen.getByRole("checkbox", {
				name: "Já criar o convite de recuperação",
			}),
		).toBeChecked();
		await user.click(screen.getByRole("button", { name: "Desvincular" }));

		expect(await screen.findByText("3RTW-8NB5-QZ6C")).toBeInTheDocument();
		expect(
			screen.getByText("Convite de recuperação para juju"),
		).toBeInTheDocument();
		expect(unlinkMember).toHaveBeenCalledWith("juliana");
		expect(createRecoveryInvite).toHaveBeenCalledWith("juliana");
		expect(vi.mocked(unlinkMember).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(createRecoveryInvite).mock.invocationCallOrder[0],
		);
	});

	it("se a recuperação falha, diz que o computador já saiu e o menu ainda oferece a recuperação", async () => {
		vi.mocked(unlinkMember).mockResolvedValue();
		vi.mocked(createRecoveryInvite).mockRejectedValue(
			new ApiError({ status: 500, kind: "internal", message: "Erro interno." }),
		);
		const user = userEvent.setup();
		renderPage();

		await openMenu(user, "juju");
		await user.click(
			await screen.findByRole("menuitem", { name: "Desvincular computador" }),
		);
		await user.click(screen.getByRole("button", { name: "Desvincular" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"O computador já saiu da conta",
		);
		await user.click(screen.getByRole("button", { name: "Fechar" }));

		await openMenu(user, "juju");
		expect(
			await screen.findByRole("menuitem", {
				name: "Criar convite de recuperação",
			}),
		).toBeInTheDocument();
	});

	it("remove depois de confirmar", async () => {
		vi.mocked(removeMember).mockResolvedValue();
		const user = userEvent.setup();
		renderPage();

		await openMenu(user, "juju");
		await user.click(
			await screen.findByRole("menuitem", { name: "Remover do grupo" }),
		);

		expect(
			screen.getByText(/Para voltar, precisa de um convite novo/),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Remover" }));

		expect(removeMember).toHaveBeenCalledWith("juliana");
	});

	it("o dono não sai do grupo nem desvincula o próprio computador", async () => {
		const user = userEvent.setup();
		renderPage();
		// O `/api/me` chega depois da lista: espera ele para o menu saber quem está usando.
		await vi.waitFor(() => expect(getMe).toHaveBeenCalled());

		await openMenu(user, "kid");

		expect(
			await screen.findByText("O dono não sai do grupo."),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("menuitem", { name: "Remover do grupo" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("menuitem", { name: "Desvincular computador" }),
		).not.toBeInTheDocument();
	});
});

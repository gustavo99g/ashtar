import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/app/router";
import { toast } from "@/components/ui/toast";
import { usePendingLinkStore } from "@/features/entry";
import {
	identityKeys,
	type Session,
	useSessionStore,
} from "@/features/identity";
import { ApiError, type InvitePreviewView, type UserView } from "@/lib/api";
import { paths } from "@/lib/paths";
import {
	accountMarker,
	installUpdate,
	login,
	pendingUpdate,
	redeem,
} from "@/lib/tauri/commands";

// O aviso no canto: o teste confere o pedido, sem desenhar o `Toaster`.
vi.mock("@/components/ui/toast", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/ui/toast")>()),
	toast: { add: vi.fn() },
}));

vi.mock("@/lib/tauri/commands", () => ({
	login: vi.fn(),
	redeem: vi.fn(),
	accountMarker: vi.fn(),
	checkForUpdate: vi.fn(() => Promise.resolve()),
	pendingUpdate: vi.fn(),
	installUpdate: vi.fn(),
	isAppError: () => false,
	onUpdateReady: vi.fn(() => Promise.resolve(() => {})),
	onUpdateFailed: vi.fn(() => Promise.resolve(() => {})),
}));

// O link que chega com o app aberto: o teste entrega com `deliver`.
let deliver: (url: string) => void = () => {};
vi.mock("@/lib/tauri/deep-link", () => ({
	openingLink: vi.fn(() => Promise.resolve(null)),
	watchLinks: vi.fn((onLink: (url: string) => void) => {
		deliver = onLink;
		return () => {};
	}),
}));

const kid: UserView = {
	id: "u1",
	nick: "kid",
	display_name: null,
	is_owner: true,
};
const lua: UserView = {
	id: "u2",
	nick: "lua",
	display_name: null,
	is_owner: false,
};
const NEW_CODE = "7KQ2-M9XD-4HPA";
const RECOVERY_CODE = "3RTW-8NB5-QZ6C";
const newInvite: InvitePreviewView = {
	kind: "new",
	invited_by: { nick: "kid", display_name: null },
	expires_at: Math.floor(Date.now() / 1000) + 300,
};
const recoveryInvite: InvitePreviewView = {
	kind: "recovery",
	account: { nick: "juju", display_name: null },
	expires_at: Math.floor(Date.now() / 1000) + 3600,
};

/** Abre o app em `path`, com a sessão e os convites já lidos no cache. */
function renderAt(path: string, session: Session) {
	useSessionStore.setState({ session });
	// Sem `staleTime`, o convite do cache seria buscado de novo, na rede de verdade.
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	queryClient.setQueryData(identityKeys.invite(NEW_CODE), newInvite);
	queryClient.setQueryData(identityKeys.invite(RECOVERY_CODE), recoveryInvite);
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

beforeEach(() => {
	vi.mocked(login).mockReset();
	vi.mocked(redeem).mockReset();
	vi.mocked(accountMarker).mockReset();
	vi.mocked(toast.add).mockReset();
	usePendingLinkStore.setState({ ready: true, pending: null });
});

describe("a abertura com um link", () => {
	it("com conta, o convite não é usado: Você já está no Ashtar", async () => {
		usePendingLinkStore.setState({ pending: { kind: "new", code: NEW_CODE } });
		vi.mocked(login).mockResolvedValue({ token: "tok", user: kid });

		const router = renderAt(paths.start, { status: "entering" });

		await screen.findByRole("heading", { name: "Você já está no Ashtar" });
		expect(router.state.location.pathname).toBe(paths.entry.alreadyIn);
		fireEvent.click(screen.getByRole("button", { name: "Continuar como kid" }));
		expect(router.state.location.pathname).toBe(paths.server);
		expect(redeem).not.toHaveBeenCalled();
	});

	it("sem conta, vai para a escolha do nick com quem convidou", async () => {
		usePendingLinkStore.setState({ pending: { kind: "new", code: NEW_CODE } });
		vi.mocked(login).mockRejectedValue(
			new ApiError({
				status: 401,
				kind: "unknown_device",
				message: "Sem conta.",
			}),
		);
		vi.mocked(accountMarker).mockResolvedValue(null);

		const router = renderAt(paths.start, { status: "entering" });

		await screen.findByRole("heading", { name: "Você recebeu um convite" });
		expect(router.state.location.pathname).toBe(paths.entry.invite(NEW_CODE));
		expect(screen.getByText(/te convidou para o Ashtar/)).toBeInTheDocument();
		expect(usePendingLinkStore.getState().pending).toBeNull();
	});
});

describe("o link com o app aberto", () => {
	it("com conta, só avisa no canto e não tira a pessoa da tela", () => {
		const router = renderAt(paths.voiceRoom, {
			status: "connected",
			user: kid,
		});

		act(() => deliver(`ashtar://invite/${NEW_CODE}`));

		expect(router.state.location.pathname).toBe(paths.voiceRoom);
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Você já está no Ashtar" }),
		);
	});

	it("com conta, um link que não é convite não avisa nada", () => {
		renderAt(paths.server, { status: "connected", user: kid });

		act(() => deliver("ashtar://outra-coisa"));

		expect(toast.add).not.toHaveBeenCalled();
	});

	it("sem conta, vai para o convite; um link que não é convite é ignorado", async () => {
		const router = renderAt(paths.entry.noInvite, { status: "noAccount" });

		act(() => deliver("ashtar://outra-coisa"));
		expect(router.state.location.pathname).toBe(paths.entry.noInvite);

		act(() => deliver(`ashtar://recovery/${RECOVERY_CODE}`));
		await screen.findByRole("heading", { name: "Trocar de computador" });
	});

	it("com a abertura em andamento, o link espera a sessão", () => {
		renderAt(paths.entry.noInvite, { status: "entering" });

		act(() => deliver(`ashtar://invite/${NEW_CODE}`));

		expect(usePendingLinkStore.getState().pending).toEqual({
			kind: "new",
			code: NEW_CODE,
		});
	});
});

describe("quem já tem conta não vê as telas de convite", () => {
	it.each([
		["Sem convite", paths.entry.noInvite],
		["Escolha do nick", paths.entry.invite(NEW_CODE)],
		["Recuperação", paths.entry.recovery(RECOVERY_CODE)],
		["Saiu do grupo", paths.entry.leftGroup],
	])("%s leva para o servidor", async (_name, path) => {
		const router = renderAt(path, { status: "connected", user: kid });

		await screen.findByRole("complementary");
		expect(router.state.location.pathname).toBe(paths.server);
	});

	it("Você já está no Ashtar continua aberta a quem tem conta", async () => {
		const router = renderAt(paths.entry.alreadyIn, {
			status: "connected",
			user: kid,
		});

		await screen.findByRole("heading", { name: "Você já está no Ashtar" });
		expect(router.state.location.pathname).toBe(paths.entry.alreadyIn);
	});

	it("com a abertura em andamento, volta para a abertura, que decide", async () => {
		// A abertura faz o login, que fica esperando enquanto o teste confere para onde foi.
		let finishLogin: (session: { token: string; user: UserView }) => void = () => {};
		vi.mocked(login).mockReturnValue(
			new Promise((resolve) => {
				finishLogin = resolve;
			}),
		);

		const router = renderAt(paths.entry.noInvite, { status: "entering" });

		expect(router.state.location.pathname).toBe(paths.start);

		// O login pendente fica guardado no `startSession` (um por abertura): se ele nunca terminasse,
		// os testes seguintes pegariam essa promessa em vez de chamar o `login` deles.
		await act(async () => finishLogin({ token: "tok", user: kid }));
	});

	it("sem conta, a tela fica, e a guarda não manda a pessoa embora ao entrar", async () => {
		const router = renderAt(paths.entry.noInvite, { status: "noAccount" });

		expect(router.state.location.pathname).toBe(paths.entry.noInvite);
		// Do campo de colar para a escolha do nick: a guarda não confere de novo.
		fireEvent.change(screen.getByLabelText("Link ou código do convite"), {
			target: { value: NEW_CODE },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
		await screen.findByRole("heading", { name: "Você recebeu um convite" });
		expect(router.state.location.pathname).toBe(paths.entry.invite(NEW_CODE));
	});
});

describe("o nome da pessoa se destaca do texto", () => {
	function highlighted(name: string) {
		return screen
			.getAllByText(name)
			.some((element) => element.dataset.slot === "person-name");
	}

	it("na escolha do nick, quem convidou", async () => {
		renderAt(paths.entry.invite(NEW_CODE), { status: "noAccount" });

		await screen.findByRole("heading", { name: "Você recebeu um convite" });
		expect(highlighted("kid")).toBe(true);
	});

	it("na recuperação, de quem é a conta", async () => {
		renderAt(paths.entry.recovery(RECOVERY_CODE), { status: "noAccount" });

		await screen.findByRole("heading", { name: "Trocar de computador" });
		expect(highlighted("juju")).toBe(true);
	});

	it("em Saiu do grupo, de quem era a conta", async () => {
		renderAt(paths.entry.leftGroup, {
			status: "leftGroup",
			account: { nick: "juju", display_name: null },
		});

		await screen.findByRole("heading", { name: "Este computador saiu do grupo" });
		expect(highlighted("juju")).toBe(true);
	});

	it("em Você já está no Ashtar, de quem é a conta deste computador", async () => {
		renderAt(paths.entry.alreadyIn, { status: "connected", user: kid });

		await screen.findByRole("heading", { name: "Você já está no Ashtar" });
		expect(highlighted("kid")).toBe(true);
	});
});

describe("o campo de colar", () => {
	it("recusa o que não é convite", () => {
		const router = renderAt(paths.entry.noInvite, { status: "noAccount" });

		fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
		expect(screen.getByText("Cole o link ou o código.")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Link ou código do convite"), {
			target: { value: "oi" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
		expect(
			screen.getByText("Isso não parece um link ou código de convite."),
		).toBeInTheDocument();
		expect(router.state.location.pathname).toBe(paths.entry.noInvite);
	});

	it("o código sozinho de uma recuperação vai para a tela da recuperação", async () => {
		const router = renderAt(paths.entry.leftGroup, {
			status: "leftGroup",
			account: { nick: "juju", display_name: null },
		});
		expect(screen.getByText("Era a conta de")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Link ou código"), {
			target: { value: "3rtw 8nb5 qz6c" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

		await screen.findByRole("heading", { name: "Trocar de computador" });
		expect(router.state.location.pathname).toBe(
			paths.entry.recovery(RECOVERY_CODE),
		);
	});
});

describe("entrar", () => {
	it("Entrar no Ashtar cria a conta com o nick e vai para o servidor", async () => {
		vi.mocked(redeem).mockResolvedValue({ token: "tok", user: lua });
		const router = renderAt(paths.entry.invite(NEW_CODE), {
			status: "noAccount",
		});

		fireEvent.change(screen.getByLabelText("Nick"), {
			target: { value: "  lua " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Entrar no Ashtar" }));

		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(paths.server),
		);
		expect(redeem).toHaveBeenCalledWith(NEW_CODE, "lua");
		expect(useSessionStore.getState().session).toEqual({
			status: "connected",
			user: lua,
		});
	});

	it("o botão só libera com um nick que passa nas regras", () => {
		renderAt(paths.entry.invite(NEW_CODE), { status: "noAccount" });
		const field = screen.getByLabelText("Nick");
		const enter = screen.getByRole("button", { name: "Entrar no Ashtar" });

		fireEvent.change(field, { target: { value: "l" } });
		expect(enter).toBeDisabled();
		expect(
			screen.getByText("O nick precisa ter pelo menos 2 caracteres."),
		).toBeInTheDocument();

		fireEvent.change(field, { target: { value: "l!" } });
		expect(enter).toBeDisabled();
		expect(field).toHaveAttribute("aria-invalid", "true");

		fireEvent.change(field, { target: { value: "lua" } });
		expect(enter).toBeEnabled();
		expect(screen.getByText("3/32")).toBeInTheDocument();
		// A letra do avatar dentro do campo.
		expect(screen.getByText("L")).toBeInTheDocument();
	});

	it("o nick em uso fica no campo, sem gastar o convite, até a pessoa trocar", async () => {
		vi.mocked(redeem).mockRejectedValue(
			new ApiError({
				status: 409,
				kind: "nick_taken",
				message: "Esse nick já está em uso.",
			}),
		);
		const router = renderAt(paths.entry.invite(NEW_CODE), {
			status: "noAccount",
		});
		const field = screen.getByLabelText("Nick");
		const enter = screen.getByRole("button", { name: "Entrar no Ashtar" });

		fireEvent.change(field, { target: { value: "kid" } });
		fireEvent.click(enter);

		await screen.findByText("Esse nick já está em uso. Tente outro.");
		expect(enter).toBeDisabled();
		expect(router.state.location.pathname).toBe(paths.entry.invite(NEW_CODE));

		fireEvent.change(field, { target: { value: "kid2" } });
		expect(
			screen.queryByText("Esse nick já está em uso. Tente outro."),
		).toBeNull();
		expect(enter).toBeEnabled();

		// O banco não diferencia maiúscula de minúscula: "KID" é o mesmo nick.
		fireEvent.change(field, { target: { value: "KID" } });
		expect(
			screen.getByText("Esse nick já está em uso. Tente outro."),
		).toBeInTheDocument();
		expect(enter).toBeDisabled();
	});

	it("invalid_nick mostra a mensagem da API no campo", async () => {
		vi.mocked(redeem).mockRejectedValue(
			new ApiError({
				status: 422,
				kind: "invalid_nick",
				message: "Mensagem da API.",
			}),
		);
		renderAt(paths.entry.invite(NEW_CODE), { status: "noAccount" });

		fireEvent.change(screen.getByLabelText("Nick"), {
			target: { value: "kid" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Entrar no Ashtar" }));

		await screen.findByText("Mensagem da API.");
		expect(screen.getByLabelText("Nick")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
	});

	it("device_already_linked faz o login e mostra Você já está no Ashtar", async () => {
		vi.mocked(redeem).mockRejectedValue(
			new ApiError({
				status: 409,
				kind: "device_already_linked",
				message: "Já vinculado.",
			}),
		);
		vi.mocked(login).mockResolvedValue({ token: "tok", user: kid });
		const router = renderAt(paths.entry.invite(NEW_CODE), {
			status: "noAccount",
		});

		fireEvent.change(screen.getByLabelText("Nick"), {
			target: { value: "lua" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Entrar no Ashtar" }));

		await screen.findByRole("button", { name: "Continuar como kid" });
		expect(router.state.location.pathname).toBe(paths.entry.alreadyIn);
	});

	it("a recuperação não pede nick e dá as boas-vindas", async () => {
		vi.mocked(redeem).mockResolvedValue({
			token: "tok",
			user: { id: "u3", nick: "juju", display_name: null, is_owner: false },
		});
		const router = renderAt(paths.entry.recovery(RECOVERY_CODE), {
			status: "noAccount",
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Usar este computador" }),
		);

		await screen.findByRole("heading", { name: "Boas-vindas de volta, juju" });
		expect(redeem).toHaveBeenCalledWith(RECOVERY_CODE, null);
		fireEvent.click(screen.getByRole("button", { name: "Abrir o Ashtar" }));
		expect(router.state.location.pathname).toBe(paths.server);
	});

	it("o código de um convite novo na rota da recuperação vai para o nick", async () => {
		const router = renderAt(paths.entry.recovery(NEW_CODE), {
			status: "noAccount",
		});

		await screen.findByRole("heading", { name: "Você recebeu um convite" });
		expect(router.state.location.pathname).toBe(paths.entry.invite(NEW_CODE));
	});
});

describe("estados e erros", () => {
	const error = (
		kind: ApiError["kind"],
		status: number,
		message = "Mensagem.",
	) =>
		new ApiError({
			status,
			kind,
			message,
			minVersion: kind === "client_outdated" ? "0.2.20" : null,
		});

	it.each([
		[error("network", 0), "Sem conexão com o servidor"],
		[error("timeout", 0), "Sem conexão com o servidor"],
		[error("too_many_attempts", 429), "Muitas tentativas"],
		[error("internal", 500), "Algo deu errado no servidor"],
		[error("http", 502), "Algo deu errado no servidor"],
		[error("client_outdated", 426), "Atualize o Ashtar para entrar"],
		[error("device_key", 0), "Não foi possível entrar"],
	])("a abertura com %s mostra %j", (failure, title) => {
		renderAt(paths.start, { status: "error", error: failure });

		expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("sem rede na abertura, Tentar de novo faz o login outra vez", async () => {
		vi.mocked(login)
			.mockRejectedValueOnce(error("network", 0))
			.mockResolvedValueOnce({ token: "tok", user: kid });
		const router = renderAt(paths.start, { status: "entering" });

		await screen.findByRole("heading", { name: "Sem conexão com o servidor" });
		fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(paths.server),
		);
		expect(login).toHaveBeenCalledTimes(2);
	});

	it("unknown_device com o marcador vai para Este computador saiu do grupo", async () => {
		vi.mocked(login).mockRejectedValue(error("unknown_device", 401));
		vi.mocked(accountMarker).mockResolvedValue({
			nick: "juju",
			display_name: null,
		});
		const router = renderAt(paths.start, { status: "entering" });

		await screen.findByRole("heading", {
			name: "Este computador saiu do grupo",
		});
		expect(router.state.location.pathname).toBe(paths.entry.leftGroup);
	});

	it.each([
		[{ status: "noAccount" } as const, paths.entry.noInvite],
		[{ status: "leftGroup", account: null } as const, paths.entry.leftGroup],
	])(
		"o convite que não vale mais aparece antes do nick (%j)",
		async (session, pasteScreen) => {
			// A resposta da API ao `GET /api/invites/{código}` de um convite gasto.
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(
					Response.json(
						{
							kind: "invalid_invite",
							message: "Convite inválido, expirado ou já usado.",
						},
						{ status: 400 },
					),
				);
			const router = renderAt(paths.entry.invite("AAAA-BBBB-CCCC"), session);

			await screen.findByRole("heading", {
				name: "Esse convite não vale mais",
			});
			expect(screen.queryByLabelText("Nick")).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Colar outro link" }));
			expect(router.state.location.pathname).toBe(pasteScreen);
			fetchSpy.mockRestore();
		},
	);

	it("muitas tentativas ao entrar: Tentar de novo manda o mesmo nick", async () => {
		vi.mocked(redeem)
			.mockRejectedValueOnce(error("too_many_attempts", 429))
			.mockResolvedValueOnce({ token: "tok", user: lua });
		const router = renderAt(paths.entry.invite(NEW_CODE), {
			status: "noAccount",
		});

		fireEvent.change(screen.getByLabelText("Nick"), {
			target: { value: "lua" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Entrar no Ashtar" }));
		await screen.findByRole("heading", { name: "Muitas tentativas" });
		fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(paths.server),
		);
		expect(redeem).toHaveBeenNthCalledWith(2, NEW_CODE, "lua");
	});

	it("versão velha: Atualizar agora instala a versão baixada", async () => {
		vi.mocked(pendingUpdate).mockResolvedValue("0.2.20");
		vi.mocked(installUpdate).mockReturnValue(new Promise(() => {}));
		renderAt(paths.start, {
			status: "error",
			error: error("client_outdated", 426),
		});

		expect(screen.getByText(/mínima 0\.2\.20/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Atualizar agora" }));

		await vi.waitFor(() => expect(installUpdate).toHaveBeenCalled());
		expect(screen.getByRole("button", { name: "Atualizando…" })).toBeDisabled();
	});
});

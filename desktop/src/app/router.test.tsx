import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
	createMemoryRouter,
	matchRoutes,
	RouterProvider,
	type RouteObject,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identityKeys, useSessionStore } from "@/features/identity";
import { ApiError, type MeResponse, type UserView } from "@/lib/api";
import { paths } from "@/lib/paths";
import { accountMarker, login } from "@/lib/tauri/commands";
import { routes } from "./router";

vi.mock("@/lib/tauri/commands", () => ({
	login: vi.fn(),
	accountMarker: vi.fn(),
	checkForUpdate: vi.fn(() => Promise.resolve()),
}));

const user: UserView = {
	id: "u1",
	nick: "kid",
	display_name: null,
	is_owner: true,
};

function me(canViewPanel: boolean): MeResponse {
	return {
		user,
		permissions: [],
		update_channel: "stable",
		can_create_invite: canViewPanel,
		can_view_panel: canViewPanel,
	};
}

/** Abre as rotas em `entries`, com a sessão conectada e o `/api/me` já no cache. */
function renderAt(entries: string[], options: { me?: MeResponse } = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(identityKeys.me(), options.me ?? me(true));
	const router = createMemoryRouter(routes, {
		initialEntries: entries,
		initialIndex: entries.length - 1,
	});
	render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

beforeEach(() => {
	useSessionStore.setState({ session: { status: "connected", user } });
	vi.mocked(login).mockReset();
	vi.mocked(accountMarker).mockReset();
});

describe("router", () => {
	it("tem uma rota para cada caminho de @/lib/paths", () => {
		const all = [
			paths.start,
			paths.entry.noInvite,
			paths.entry.invite("7KQ2-M9XD-4HPA"),
			paths.entry.recovery("3RTW-8NB5-QZ6C"),
			paths.entry.alreadyIn,
			paths.entry.leftGroup,
			paths.server,
			paths.voiceRoom,
			...Object.values(paths.settings),
		];
		for (const path of all) {
			expect(matchRoutes(routes, path), path).not.toBeNull();
		}
	});

	it("abre as configurações no Perfil", () => {
		const router = renderAt([paths.server, paths.settings.root]);
		expect(router.state.location.pathname).toBe(paths.settings.profile);
	});

	it("o ESC fecha as configurações e volta para onde estava, mesmo depois de trocar de página", () => {
		const router = renderAt([paths.server, paths.settings.profile]);

		fireEvent.click(screen.getByRole("link", { name: "Membros" }));
		expect(router.state.location.pathname).toBe(paths.settings.members);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(router.state.location.pathname).toBe(paths.server);
	});

	it("o ESC que um diálogo já usou não fecha as configurações", () => {
		const router = renderAt([paths.server, paths.settings.profile]);

		const event = new KeyboardEvent("keydown", {
			key: "Escape",
			cancelable: true,
		});
		event.preventDefault();
		window.dispatchEvent(event);

		expect(router.state.location.pathname).toBe(paths.settings.profile);
	});

	it("o botão de configurações da coluna abre o Perfil", () => {
		const router = renderAt([paths.server]);
		const column = screen.getByRole("complementary");
		fireEvent.click(
			within(column).getByRole("link", { name: "Configurações" }),
		);
		expect(router.state.location.pathname).toBe(paths.settings.profile);
	});

	it("sem can_view_panel, o menu não mostra o Painel de controle", () => {
		renderAt([paths.server, paths.settings.profile], { me: me(false) });

		expect(screen.queryByText("Painel de controle")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Membros" }),
		).not.toBeInTheDocument();
	});
});

describe("a abertura", () => {
	beforeEach(() => {
		useSessionStore.setState({ session: { status: "entering" } });
	});

	it("o login certo vai para o servidor", async () => {
		vi.mocked(login).mockResolvedValue({ token: "tok", user });

		const router = renderAt([paths.start]);

		await screen.findByRole("complementary");
		expect(router.state.location.pathname).toBe(paths.server);
		expect(login).toHaveBeenCalledTimes(1);
	});

	it("sem conta e sem marcador vai para o convite", async () => {
		vi.mocked(login).mockRejectedValue(
			new ApiError({
				status: 401,
				kind: "unknown_device",
				message: "Sem conta.",
			}),
		);
		vi.mocked(accountMarker).mockResolvedValue(null);

		const router = renderAt([paths.start]);

		await screen.findByText("Você precisa de um convite");
		expect(router.state.location.pathname).toBe(paths.entry.noInvite);
	});

	it("sem rede mostra o erro, e Tentar de novo faz outro login", async () => {
		vi.mocked(login).mockRejectedValueOnce(
			new ApiError({ status: 0, kind: "network", message: "Sem rede." }),
		);

		const router = renderAt([paths.start]);

		const retry = await screen.findByRole("button", { name: "Tentar de novo" });
		vi.mocked(login).mockResolvedValue({ token: "tok", user });
		fireEvent.click(retry);
		await screen.findByRole("complementary");
		expect(router.state.location.pathname).toBe(paths.server);
		expect(login).toHaveBeenCalledTimes(2);
	});
});

const SAMPLE_CODE = "ABCD-EFGH-JK00";

/** A rota mais funda que casou, a da tela. */
function last(matches: ReturnType<typeof matchRoutes>) {
	return matches?.[matches.length - 1];
}

/** Todo endereço de `paths`, com um código de exemplo nos que pedem um. */
function allPaths(node: unknown): string[] {
	if (typeof node === "string") return [node];
	if (typeof node === "function") return [node(SAMPLE_CODE) as string];
	return Object.values(node as object).flatMap(allPaths);
}

/** O caminho completo de cada rota que mostra uma tela (as de layout, sem caminho, só repassam). */
function leafPaths(list: RouteObject[], parent = ""): string[] {
	return list.flatMap((route) => {
		const own = route.path ?? "";
		const full = own.startsWith("/")
			? own
			: `${parent}/${own}`.replace(/\/+/g, "/");
		const base = full === "" ? "/" : full;
		if (route.children) return leafPaths(route.children, base);
		return route.index ? [] : [base.replace(/\/$/, "") || "/"];
	});
}

describe("endereços e rotas", () => {
	it("toda rota de tela tem um endereço em `paths`", () => {
		const known = allPaths(paths).map((path) =>
			path.replace(SAMPLE_CODE, ":code"),
		);

		for (const path of leafPaths(routes)) {
			expect(known, `${path} está no router mas não em paths`).toContain(path);
		}
	});

	it("o código do convite vai como parâmetro", () => {
		const matches = matchRoutes(routes, paths.entry.invite(SAMPLE_CODE));

		expect(last(matches)?.params.code).toBe(SAMPLE_CODE);
	});

	it("o código com caracteres especiais é escapado e volta inteiro", () => {
		const matches = matchRoutes(routes, paths.entry.recovery("a b/c"));

		expect(last(matches)?.params.code).toBe("a b/c");
	});

	it("um endereço que não existe não casa com nada", () => {
		expect(matchRoutes(routes, "/entrada/convite/abc")).toBeNull();
		expect(matchRoutes(routes, "/nao-existe")).toBeNull();
	});
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
	createMemoryRouter,
	matchRoutes,
	type RouteObject,
	RouterProvider,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identityKeys, useSessionStore } from "@/features/identity";
import { VoiceProvider } from "@/features/voice";
import { ApiError, type MeResponse, type UserView } from "@/lib/api";
import { DEFAULT_CHANNEL_ID } from "@/features/channels";
import { paths } from "@/lib/paths";
import { accountMarker, login } from "@/lib/tauri/commands";
import { routes } from "./router";

/** Para onde o `/server` leva: o último canal de texto, o #geral na primeira vez. */
const HOME = paths.channel(DEFAULT_CHANNEL_ID);

vi.mock("@/lib/tauri/commands", () => ({
	// A ponta dos avisos, na moldura (`NotificationsBridge`).
	setUnreadBadge: vi.fn(() => Promise.resolve()),
	onNotificationOpen: vi.fn(() => Promise.resolve(() => {})),
	onNotificationAnswer: vi.fn(() => Promise.resolve(() => {})),
	onSystemResumed: vi.fn(() => () => {}),
	notificationRing: vi.fn(() => Promise.resolve()),
	// O jogo aberto (`ActivitySync`): nenhum.
	activityState: vi.fn(() => Promise.resolve(null)),
	onActivityChanged: vi.fn(() => Promise.resolve(() => {})),
	activityDetectableEtag: vi.fn(() => Promise.resolve(null)),
	activitySetDetectable: vi.fn(() => Promise.resolve()),
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
		status: "available",
		can_create_invite: canViewPanel,
		can_view_panel: canViewPanel,
		can_manage_channels: false,
		can_move_members: false, can_manage_emojis: false, can_view_logs: false, can_moderate_voice: false,
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
			<VoiceProvider>
				<RouterProvider router={router} />
			</VoiceProvider>
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
	it("Voz e vídeo abre a aba dos dispositivos", () => {
		const router = renderAt([paths.server, paths.settings.profile]);

		fireEvent.click(screen.getByRole("link", { name: "Voz e vídeo" }));

		expect(router.state.location.pathname).toBe(paths.settings.voice);
		expect(
			screen.getByRole("heading", { name: "Voz e vídeo" }),
		).toBeInTheDocument();
	});

	it("o ESC fecha as configurações e volta para onde estava, mesmo depois de trocar de página", async () => {
		const router = renderAt([paths.server, paths.settings.profile]);

		fireEvent.click(screen.getByRole("link", { name: "Membros" }));
		expect(router.state.location.pathname).toBe(paths.settings.members);

		fireEvent.keyDown(window, { key: "Escape" });
		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(HOME),
		);
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

	it("as configurações cobrem a moldura inteira: nenhum ancestral posicionado entre elas e a moldura", () => {
		renderAt([paths.server, paths.settings.profile]);
		// A raiz das configurações é `absolute inset-0`: ela cobre o ancestral posicionado mais
		// perto. Se algum `relative` ficar entre ela e a moldura (o `main`, por exemplo), ela cobre
		// só a área do meio e a coluna do servidor continua à mostra.
		let root: HTMLElement | null = screen.getByRole("link", { name: "Perfil" });
		while (root && !/(^|\s)inset-0(\s|$)/.test(root.className)) {
			root = root.parentElement;
		}
		expect(root, "a raiz das configurações").not.toBeNull();

		const shell = document.querySelector(
			'aside[aria-label="Servidor"]',
		)?.parentElement;
		const positioned = /(^|\s)(relative|absolute|fixed|sticky)(\s|$)/;
		for (
			let ancestor = root?.parentElement ?? null;
			ancestor && ancestor !== shell;
			ancestor = ancestor.parentElement
		) {
			expect(
				ancestor.className,
				`${ancestor.tagName.toLowerCase()} fica entre as configurações e a moldura`,
			).not.toMatch(positioned);
		}
	});

	it("o AppShell não deixa texto solto ao lado das colunas", () => {
		renderAt([paths.server]);
		const shell = screen.getByRole("complementary", { name: "Servidor" }).parentElement;
		const loose = Array.from(shell?.childNodes ?? []).filter(
			(node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
		);
		expect(loose).toEqual([]);
	});

	it("o botão de configurações da coluna abre o Perfil", () => {
		const router = renderAt([paths.server]);
		const column = screen.getByRole("complementary", { name: "Servidor" });
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

describe("Servidor › Arquivados", () => {
	it("só aparece no menu de quem gerencia os canais", () => {
		renderAt([paths.server, paths.settings.profile]);
		expect(screen.queryByRole("link", { name: "Arquivados" })).toBeNull();
	});

	it("com can_manage_channels, o menu leva para a página", () => {
		const router = renderAt([paths.server, paths.settings.profile], {
			me: { ...me(true), can_manage_channels: true },
		});

		fireEvent.click(screen.getByRole("link", { name: "Arquivados" }));

		expect(router.state.location.pathname).toBe(paths.settings.archived);
		expect(
			screen.getByRole("heading", { name: "Arquivados" }),
		).toBeInTheDocument();
	});
});

describe("a abertura", () => {
	beforeEach(() => {
		useSessionStore.setState({ session: { status: "entering" } });
	});

	it("o login certo vai para o servidor", async () => {
		vi.mocked(login).mockResolvedValue({ token: "tok", user });

		const router = renderAt([paths.start]);

		await screen.findByRole("complementary", { name: "Servidor" });
		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(HOME),
		);
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
		await screen.findByRole("complementary", { name: "Servidor" });
		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe(HOME),
		);
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

	it("o canal vai como parâmetro, escapado, e bate com o padrão de paths", () => {
		const matches = matchRoutes(routes, paths.channel("geral"));
		expect(last(matches)?.route.path).toBe(paths.channelPattern);
		expect(last(matches)?.params.channelId).toBe("geral");

		const odd = matchRoutes(routes, paths.channel("a b/c"));
		expect(last(odd)?.params.channelId).toBe("a b/c");
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

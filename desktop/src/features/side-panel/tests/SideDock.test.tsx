import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { listDms, listPeople, listVoiceParticipants } from "@/lib/api";
import { paths } from "@/lib/paths";
import { SideDock } from "../components/SideDock";
import { useSidePanelStore } from "../stores/sidePanelStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listDms: vi.fn(),
	listPeople: vi.fn(),
	listVoiceParticipants: vi.fn(),
}));

const kid = { id: "u1", nick: "kid", display_name: null, is_owner: true };

function renderAt(path: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<SideDock />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	localStorage.clear();
	useSidePanelStore.setState({
		openInText: true,
		openInVoice: false,
		tab: "members",
	});
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	vi.mocked(listPeople).mockResolvedValue([
		{ ...kid, online: true, status: "available" },
	]);
	vi.mocked(listVoiceParticipants).mockResolvedValue([]);
	vi.mocked(listDms).mockResolvedValue([]);
});

describe("SideDock", () => {
	it("no canal de texto começa aberta, na aba Membros", async () => {
		renderAt(paths.channel("geral"));
		const side = screen.getByRole("complementary", { name: "Lateral" });
		expect(
			within(side).getByRole("tab", { name: "Membros" }),
		).toHaveAttribute("aria-selected", "true");
		expect(await within(side).findByText("kid")).toBeInTheDocument();
	});

	it("na sala de voz começa minimizada", () => {
		renderAt(paths.voiceRoom);
		expect(
			screen.getByRole("complementary", { name: "Lateral minimizada" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("tab")).not.toBeInTheDocument();
	});

	it("nas configurações não aparece", () => {
		const { container } = renderAt(paths.settings.profile);
		expect(container).toBeEmptyDOMElement();
	});

	it("minimiza e abre de novo, e cada tela lembra o seu jeito", async () => {
		const user = userEvent.setup();
		const text = renderAt(paths.channel("geral"));
		await user.click(screen.getByRole("button", { name: "Minimizar lateral" }));
		expect(
			screen.getByRole("complementary", { name: "Lateral minimizada" }),
		).toBeInTheDocument();
		expect(useSidePanelStore.getState().openInText).toBe(false);
		// A sala não mudou: lá ela já estava minimizada, e abrir lá não abre no texto.
		text.unmount();
		renderAt(paths.voiceRoom);
		await user.click(screen.getByRole("button", { name: "Abrir lateral" }));
		expect(useSidePanelStore.getState()).toMatchObject({
			openInText: false,
			openInVoice: true,
		});
		// O que foi escolhido vai para o disco.
		expect(localStorage.getItem("ashtar-side-panel")).toContain(
			'"openInVoice":true',
		);
	});

	it("a aba Conversas mostra o estado vazio, e a aba é a mesma nas duas telas", async () => {
		const user = userEvent.setup();
		const text = renderAt(paths.channel("geral"));
		await user.click(screen.getByRole("tab", { name: "Conversas" }));
		expect(await screen.findByText("Nenhuma conversa ainda")).toBeInTheDocument();
		expect(screen.queryByText("kid")).not.toBeInTheDocument();
		text.unmount();

		useSidePanelStore.setState({ openInVoice: true });
		renderAt(paths.voiceRoom);
		expect(screen.getByRole("tab", { name: "Conversas" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("o ícone da faixa abre a lateral já naquela aba", async () => {
		const user = userEvent.setup();
		renderAt(paths.voiceRoom);
		await user.click(screen.getByRole("button", { name: "Conversas" }));
		expect(screen.getByRole("tab", { name: "Conversas" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("um valor estranho no disco volta para o padrão", async () => {
		localStorage.setItem(
			"ashtar-side-panel",
			JSON.stringify({
				state: { openInText: "sim", tab: "amigos" },
				version: 1,
			}),
		);
		await useSidePanelStore.persist.rehydrate();
		expect(useSidePanelStore.getState()).toEqual({
			openInText: true,
			openInVoice: false,
			tab: "members",
		});
	});
});

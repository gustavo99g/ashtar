import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCurrentGame } from "@/features/activity";
import type { ScreenShareState } from "@/features/screen-share";
import type { CaptureSource, GameView } from "@/lib/tauri/commands";
import { setGameHidden } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import { useVoice } from "../../room/hooks/useVoice";
import {
	GameCard,
	usePendingGameShare,
	WINDOW_CHECK_MS,
} from "../components/GameCard";

vi.mock("../../room/hooks/useVoice", () => ({ useVoice: vi.fn() }));
vi.mock("../../members/hooks/useRoomOccupancy", () => ({
	useRoomOccupancy: () =>
		new Map([
			["ana", { roomId: "sala-1", roomName: "Geral", sharing: false }],
			["bia", { roomId: "sala-1", roomName: "Geral", sharing: false }],
		]),
}));
vi.mock("@/features/channels", () => ({
	useOptionalChannelLayout: () => ({}),
	allChannels: () => [
		{ id: "sala-1", name: "Geral", kind: "voice", restricted: false },
		{ id: "sala-2", name: "Jogos", kind: "voice", restricted: false },
		{ id: "texto", name: "geral", kind: "text", restricted: false },
		{
			id: "privada",
			name: "Privada",
			kind: "voice",
			restricted: true,
			member_ids: [],
		},
	],
}));
vi.mock("@/lib/tauri/commands", async (importOriginal) => ({
	...(await importOriginal<object>()),
	setGameHidden: vi.fn(async () => {}),
}));

const GAME: GameView = {
	id: "hades",
	name: "Hades",
	exe: String.raw`C:\Steam\Hades\Hades.exe`,
	source: "steam",
	pid: 42,
	startedMs: Date.now() - 12 * 60_000,
	icon: null,
	family: [42],
	windowReady: true,
};

const GAME_WINDOW: CaptureSource = {
	source: { kind: "window", id: 7 },
	title: "Hades",
	processId: 42,
	icon: null,
	monitor: null,
	minimized: false,
};

function voice({
	inRoom,
	voiceChannelId = inRoom ? "sala-1" : null,
	state = { status: "idle" },
}: {
	inRoom: boolean;
	voiceChannelId?: string | null;
	state?: ScreenShareState;
}) {
	const controller = fakeShareController(state, [GAME_WINDOW]);
	const join = vi.fn();
	vi.mocked(useVoice).mockReturnValue({
		voiceChannelId,
		room: inRoom ? ({} as never) : null,
		screenShare: controller,
		join,
	} as never);
	return { controller, join };
}

function renderCard() {
	return render(
		<MemoryRouter>
			<GameCard />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	setCurrentGame(GAME);
});

afterEach(() => {
	setCurrentGame(null);
	usePendingGameShare.setState({ pid: null });
});

describe("GameCard", () => {
	it("sem jogo aberto, não aparece", () => {
		setCurrentGame(null);
		voice({ inRoom: false });
		const { container } = renderCard();
		expect(container).toBeEmptyDOMElement();
	});

	it("mostra o jogo, há quanto tempo e o Transmitir", () => {
		voice({ inRoom: false });
		renderCard();
		expect(screen.getByText("Jogando agora")).toBeInTheDocument();
		expect(screen.getByText("Hades")).toBeInTheDocument();
		expect(screen.getByText("há 12 min")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Transmitir" }),
		).toBeInTheDocument();
	});

	it("numa sala, transmite a janela do jogo direto, com o padrão do seletor", async () => {
		const { controller } = voice({ inRoom: true });
		renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Transmitir" }));
		await waitFor(() => expect(controller.start).toHaveBeenCalledTimes(1));
		const [request] = controller.start.mock.calls[0] as unknown as [
			{ source: CaptureSource; audio: unknown },
		];
		expect(request.source).toBe(GAME_WINDOW);
		expect(request.audio).toEqual({ mode: "application", processId: 42 });
	});

	it("o processo do cartão sem janela: transmite a do outro processo do jogo", async () => {
		// O LeagueClient.exe (40) não tem janela; o LeagueClientUx.exe (42) tem.
		setCurrentGame({ ...GAME, pid: 40, family: [40, 42] });
		const { controller } = voice({ inRoom: true });
		renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Transmitir" }));
		await waitFor(() => expect(controller.start).toHaveBeenCalledTimes(1));
		const [request] = controller.start.mock.calls[0] as unknown as [
			{ source: CaptureSource },
		];
		expect(request.source).toBe(GAME_WINDOW);
	});

	it("sem a janela do jogo pronta, o cartão não aparece", () => {
		setCurrentGame({ ...GAME, windowReady: false });
		voice({ inRoom: true });
		const { container } = renderCard();
		expect(container).toBeEmptyDOMElement();
	});

	it("a janela ainda não abriu: espera ela aparecer e transmite", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { controller } = voice({ inRoom: true });
		const listed = vi.mocked(controller.listSources);
		listed.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
		renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Transmitir" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Transmitir" })).toBeDisabled(),
		);
		await act(() => vi.advanceTimersByTimeAsync(WINDOW_CHECK_MS * 2));
		await waitFor(() => expect(controller.start).toHaveBeenCalledTimes(1));
		vi.useRealTimers();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Transmitir" })).toBeEnabled(),
		);
	});

	it("já transmitindo outra coisa, troca a fonte sem parar", async () => {
		const { controller } = voice({
			inRoom: true,
			state: {
				status: "active",
				sessionId: 1,
				startedAt: 0,
				source: { ...GAME_WINDOW, processId: 99 },
				quality: "1080p60",
				audioMode: { mode: "off" },
				cursor: true,
				leveler: true,
				paused: false,
				audio: "off",
				link: "ok",
			},
		});
		renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Transmitir" }));
		await waitFor(() =>
			expect(controller.update).toHaveBeenCalledWith({
				kind: "source",
				source: GAME_WINDOW,
			}),
		);
		expect(controller.start).not.toHaveBeenCalled();
	});

	it("transmitindo o jogo, some o botão e o nome ganha a bolinha", () => {
		voice({
			inRoom: true,
			state: {
				status: "active",
				sessionId: 1,
				startedAt: 0,
				source: GAME_WINDOW,
				quality: "1080p60",
				audioMode: { mode: "off" },
				cursor: true,
				leveler: true,
				paused: false,
				audio: "off",
				link: "ok",
			},
		});
		renderCard();
		expect(
			screen.queryByRole("button", { name: "Transmitir" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("img", { name: "Transmitindo" })).toBeInTheDocument();
	});

	it("fora da voz, abre as salas e só transmite depois de conectar", async () => {
		const { join, controller } = voice({ inRoom: false });
		const { rerender } = renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Transmitir" }));

		// As salas de voz da lista, com quantos estão nelas. A restrita também: a lista só traz as
		// que a pessoa acessa.
		expect(await screen.findByText("2 pessoas")).toBeInTheDocument();
		expect(screen.getAllByText("vazia")).toHaveLength(2);
		expect(screen.getByText("Privada")).toBeInTheDocument();
		expect(screen.queryByText("geral")).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: /Jogos/ }));
		expect(join).toHaveBeenCalledWith("sala-2");
		expect(controller.start).not.toHaveBeenCalled();

		// Conectando: ainda nada.
		vi.mocked(useVoice).mockReturnValue({
			voiceChannelId: "sala-2",
			room: null,
			screenShare: controller,
			join,
		} as never);
		rerender(
			<MemoryRouter>
				<GameCard />
			</MemoryRouter>,
		);
		expect(controller.start).not.toHaveBeenCalled();

		// Conectou: começa.
		vi.mocked(useVoice).mockReturnValue({
			voiceChannelId: "sala-2",
			room: {} as never,
			screenShare: controller,
			join,
		} as never);
		rerender(
			<MemoryRouter>
				<GameCard />
			</MemoryRouter>,
		);
		await waitFor(() => expect(controller.start).toHaveBeenCalledTimes(1));
	});

	it("“Não mostrar para este jogo” esconde pelo Rust", async () => {
		voice({ inRoom: false });
		renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Opções de Hades" }));
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "Não mostrar para este jogo" }),
		);
		expect(setGameHidden).toHaveBeenCalledWith("hades", true);
	});

	it("o jogo que muda chega pelo store", () => {
		voice({ inRoom: false });
		renderCard();
		act(() => setCurrentGame({ ...GAME, id: "outro", name: "Outro jogo" }));
		expect(screen.getByText("Outro jogo")).toBeInTheDocument();
	});
});

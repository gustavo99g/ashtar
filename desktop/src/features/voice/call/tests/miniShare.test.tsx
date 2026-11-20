import type { TrackReference } from "@livekit/components-react";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenShares } from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import { useVoice } from "../../room/hooks/useVoice";
import { MiniShare } from "../components/MiniShare";
import { useMiniShare } from "../stores/miniShareStore";
import { useRoomView, watchShare } from "../stores/roomViewStore";

vi.mock("../../room/hooks/useVoice", () => ({ useVoice: vi.fn() }));
vi.mock("../../members/hooks/useLiveMembers", () => ({
	useLiveMembers: vi.fn(),
}));
vi.mock("@/features/screen-share", () => ({ useScreenShares: vi.fn() }));
vi.mock("@livekit/components-react", () => ({
	VideoTrack: () => <video aria-label="vídeo" />,
	useConnectionQualityIndicator: () => ({ quality: quality.current }),
}));
/** A qualidade da conexão de quem transmite, como a LiveKit dá. */
const quality = vi.hoisted(() => ({ current: "excellent" }));
vi.mock("@/features/screen-share", () => ({
	useScreenShares: vi.fn(),
	shareOwner: (identity: string) => identity.replace(/:screen$/, ""),
}));

/** A transmissão da juju, já assinada, sem áudio. */
const share = {
	participant: {
		identity: "juju:screen",
		isLocal: false,
		getTrackPublication: () => undefined,
	},
	publication: { isSubscribed: true, track: {}, trackName: "screen" },
	source: "screen_share",
} as unknown as TrackReference;

const juju = {
	id: "juju",
	nick: "juju",
	name: "Juju",
	sharing: true,
	speaking: false,
	micOff: false,
	deafened: false,
};

function renderAt(path: string) {
	const router = createMemoryRouter([{ path: "*", element: <MiniShare /> }], {
		initialEntries: [path],
	});
	render(<RouterProvider router={router} />);
	return router;
}

beforeEach(() => {
	localStorage.clear();
	useMiniShare.setState({ corner: "bottom-right", collapsed: false });

	useRoomView.setState({
		watching: [],
		focused: null,
		miniPick: null,
		shown: {},
	});
	vi.mocked(useVoice).mockReturnValue({ room: {} } as never);
	vi.mocked(useLiveMembers).mockReturnValue([juju] as never);
	const jujuShare = { track: share, ownerId: "juju", isOwn: false };

	vi.mocked(useScreenShares).mockReturnValue([jujuShare]);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("a miniatura da transmissão", () => {
	it("a conexão de quem transmite caída mostra que ela está voltando", () => {
		quality.current = "lost";
		vi.mocked(useScreenShares).mockReturnValue([
			{ track: share, ownerId: "juju", isOwn: false },
		]);
		act(() => watchShare("juju"));
		renderAt(paths.channel("geral"));

		expect(
			screen.getByText("Reconectando a transmissão…"),
		).toBeInTheDocument();
		quality.current = "excellent";
	});

	it("a transmissão pausada (a trilha silenciada) mostra o aviso", () => {
		const paused = {
			...share,
			publication: { ...share.publication, isMuted: true },
		} as unknown as TrackReference;
		const pausedShare = { track: paused, ownerId: "juju", isOwn: false };
		vi.mocked(useScreenShares).mockReturnValue([pausedShare]);
		act(() => watchShare("juju"));
		renderAt(paths.channel("geral"));

		expect(screen.getByText("Transmissão pausada")).toBeInTheDocument();
	});

	it("aparece fora da sala para quem estava assistindo, e baixa a tela", () => {
		act(() => watchShare("juju"));
		renderAt(paths.channel("geral"));

		expect(
			screen.getByRole("region", { name: "Transmissão de Juju, em miniatura" }),
		).toBeInTheDocument();
		expect(useRoomView.getState().shown).toEqual({ juju: "full" });
	});

	it("não aparece na Grade, na própria sala nem nas configurações", () => {
		renderAt(paths.channel("geral"));
		expect(screen.queryByRole("region")).toBeNull();
		cleanup();

		act(() => watchShare("juju"));
		const router = renderAt(paths.voiceRoom);
		expect(screen.queryByRole("region")).toBeNull();

		act(() => void router.navigate(paths.settings.voice));
		expect(screen.queryByRole("region")).toBeNull();
		// Nas configurações, nada é baixado.
		expect(useRoomView.getState().shown).toEqual({});
	});

	it("Voltar para a sala abre a sala; o X para de assistir", () => {
		act(() => watchShare("juju"));
		const router = renderAt(paths.channel("geral"));

		fireEvent.click(screen.getByRole("button", { name: "Voltar para a sala" }));
		expect(router.state.location.pathname).toBe(paths.voiceRoom);

		act(() => void router.navigate(paths.channel("geral")));
		fireEvent.click(screen.getByRole("button", { name: "Parar de assistir" }));
		expect(useRoomView.getState()).toMatchObject({ watching: [], shown: {} });
		expect(screen.queryByRole("region")).toBeNull();
	});

	it("a transmissão acabou: a miniatura some", () => {
		act(() => watchShare("juju"));
		const router = renderAt(paths.channel("geral"));
		expect(screen.getByRole("region")).toBeInTheDocument();

		vi.mocked(useScreenShares).mockReturnValue([]);
		act(() => void router.navigate(paths.channel("jogos")));

		expect(useRoomView.getState().shown).toEqual({});
		expect(screen.queryByRole("region")).toBeNull();
	});

	it("arrastada, vai para o canto mais perto e grava", () => {
		act(() => watchShare("juju"));
		renderAt(paths.channel("geral"));
		const mini = screen.getByRole("region");
		// O jsdom não calcula layout: a área e a posição vêm daqui.
		Object.defineProperty(mini, "offsetParent", {
			value: { clientWidth: 1000, clientHeight: 600 },
		});
		Object.defineProperty(mini, "offsetLeft", { value: 664 });
		Object.defineProperty(mini, "offsetTop", { value: 404 });
		mini.setPointerCapture = vi.fn();

		fireEvent.pointerDown(mini, {
			button: 0,
			clientX: 700,
			clientY: 450,
			pointerId: 1,
		});
		fireEvent.pointerMove(mini, { clientX: 100, clientY: 60, pointerId: 1 });

		// Arrastando: os seis encaixes, com o mais perto destacado.
		const targets = document.querySelectorAll("[data-slot-target]");
		expect(targets).toHaveLength(6);
		expect(document.querySelector("[data-nearest]")).toHaveAttribute(
			"data-slot-target",
			"top-left",
		);
		expect(screen.getByText("Solte para encaixar")).toBeInTheDocument();

		fireEvent.pointerUp(mini, { pointerId: 1 });

		expect(useMiniShare.getState().corner).toBe("top-left");
		expect(mini).toHaveAttribute("data-corner", "top-left");
		expect(document.querySelectorAll("[data-slot-target]")).toHaveLength(0);
	});

	it("solta no meio da lateral, encaixa no meio", () => {
		act(() => watchShare("juju"));
		renderAt(paths.channel("geral"));
		const mini = screen.getByRole("region");
		Object.defineProperty(mini, "offsetParent", {
			value: { clientWidth: 1000, clientHeight: 600 },
		});
		Object.defineProperty(mini, "offsetLeft", { value: 664 });
		Object.defineProperty(mini, "offsetTop", { value: 404 });
		mini.setPointerCapture = vi.fn();

		fireEvent.pointerDown(mini, {
			button: 0,
			clientX: 700,
			clientY: 450,
			pointerId: 1,
		});
		fireEvent.pointerMove(mini, { clientX: 100, clientY: 300, pointerId: 1 });
		fireEvent.pointerUp(mini, { pointerId: 1 });

		expect(useMiniShare.getState().corner).toBe("left");
	});

	it("recolhida, vira a aba na lateral e o som continua; a aba abre de novo", () => {
		act(() => watchShare("juju"));
		renderAt(paths.channel("geral"));

		fireEvent.click(
			screen.getByRole("button", { name: "Recolher a miniatura" }),
		);

		expect(screen.queryByRole("region")).toBeNull();
		expect(useMiniShare.getState().collapsed).toBe(true);
		// Continua assistindo: a tela segue baixada, e o som com ela.
		expect(useRoomView.getState().shown).toEqual({ juju: "full" });

		fireEvent.click(
			screen.getByRole("button", {
				name: "Abrir a miniatura da transmissão de Juju",
			}),
		);
		expect(screen.getByRole("region")).toBeInTheDocument();
		expect(useMiniShare.getState().collapsed).toBe(false);
	});

	it("com várias abertas, mostra uma e as setas trocam, baixando só a que aparece", () => {
		const marcao = { ...juju, id: "marcao", nick: "marcao", name: "Marcão" };
		const marcaoTrack = {
			...share,
			participant: { ...share.participant, identity: "marcao:screen" },
		} as unknown as TrackReference;
		vi.mocked(useLiveMembers).mockReturnValue([juju, marcao] as never);
		vi.mocked(useScreenShares).mockReturnValue([
			{ track: share, ownerId: "juju", isOwn: false },
			{ track: marcaoTrack, ownerId: "marcao", isOwn: false },
		]);
		act(() => {
			watchShare("juju");
			watchShare("marcao");
		});
		renderAt(paths.channel("geral"));

		expect(screen.getByRole("region")).toHaveAccessibleName(
			"Transmissão de Juju, em miniatura",
		);
		expect(screen.getByText("1/2")).toBeInTheDocument();
		expect(useRoomView.getState().shown).toEqual({ juju: "full" });

		fireEvent.click(
			screen.getByRole("button", { name: "Próxima transmissão" }),
		);
		expect(screen.getByRole("region")).toHaveAccessibleName(
			"Transmissão de Marcão, em miniatura",
		);
		expect(useRoomView.getState().shown).toEqual({ marcao: "full" });
		// Trocar não volta para a sala nem fecha a outra.
		expect(useRoomView.getState().watching).toEqual(["juju", "marcao"]);
	});

	it("com uma só, as setas somem", () => {
		act(() => watchShare("juju"));
		renderAt(paths.channel("geral"));
		expect(
			screen.queryByRole("button", { name: "Próxima transmissão" }),
		).toBeNull();
	});
});

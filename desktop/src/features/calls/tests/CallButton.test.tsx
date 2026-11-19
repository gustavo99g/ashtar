import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenShareState } from "@/features/screen-share";
import { useSettingsStore } from "@/features/settings";
import { useMaybeVoice } from "@/features/voice";
import { ApiError, startCall } from "@/lib/api";
import { CallButton } from "../components/CallButton";
import { CallEntry } from "../components/CallEntry";
import { applyCall, applyReady, resetCalls } from "../stores/callStore";
import { ana, callView, kid } from "./fixtures";

vi.mock("@/features/voice", () => ({
	SALA: { id: "sala", name: "Sala" },
	useMaybeVoice: vi.fn(),
	useShareViewers: vi.fn(() => new Map([["bia", 1], ["caio", 2]])),
}));
vi.mock("@/features/screen-share", () => ({
	useScreenShareState: vi.fn(() => ({ status: "idle" })),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	startCall: vi.fn(),
}));

function inRoom(room: boolean) {
	vi.mocked(useMaybeVoice).mockReturnValue(
		(room
			? { voiceKind: "room", room: null, screenShare: null }
			: null) as ReturnType<typeof useMaybeVoice>,
	);
}

function card(presence: "available" | null = "available") {
	return (
		<CallButton
			variant="card"
			person={ana}
			presence={presence}
			resolveDm={() => Promise.resolve("d1")}
		/>
	);
}

describe("o botão Ligar", () => {
	beforeEach(() => {
		resetCalls();
		applyReady("kid", null);
		vi.clearAllMocks();
		inRoom(false);
		useSettingsStore.setState({ askBeforeCall: true });
		vi.mocked(startCall).mockResolvedValue(callView());
	});

	it("para quem está offline fica apagado, com o motivo", () => {
		render(card(null));
		expect(screen.getByRole("button", { name: /Ligar/ })).toBeDisabled();
		expect(screen.getByText("ana está offline agora.")).toBeInTheDocument();
	});

	it("fora de sala, liga direto", async () => {
		render(card());
		await userEvent.click(screen.getByRole("button", { name: /Ligar/ }));
		expect(startCall).toHaveBeenCalledWith("d1");
	});

	it("numa sala, pergunta antes; o Não perguntar de novo desliga a pergunta", async () => {
		inRoom(true);
		render(card());
		await userEvent.click(screen.getByRole("button", { name: /Ligar/ }));
		expect(screen.getByText("Ligar para ana?")).toBeInTheDocument();
		expect(startCall).not.toHaveBeenCalled();
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Não perguntar de novo" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Ligar" }));
		expect(startCall).toHaveBeenCalledWith("d1");
		expect(useSettingsStore.getState().askBeforeCall).toBe(false);
	});

	it("transmitindo, pergunta sempre e diz quantos estão assistindo", async () => {
		inRoom(true);
		useSettingsStore.setState({ askBeforeCall: false });
		vi.mocked(useScreenShareState).mockReturnValue({
			status: "active",
		} as ReturnType<typeof useScreenShareState>);
		render(card());
		await userEvent.click(screen.getByRole("button", { name: /Ligar/ }));
		expect(
			screen.getByText("Ligar e encerrar a transmissão?"),
		).toBeInTheDocument();
		expect(screen.getByText(/2 pessoas estão assistindo/)).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Encerrar e ligar" }),
		);
		expect(startCall).toHaveBeenCalledWith("d1");
		vi.mocked(useScreenShareState).mockReturnValue({ status: "idle" });
	});

	it("mostra o motivo que a API deu", async () => {
		vi.mocked(startCall).mockRejectedValue(
			new ApiError({
				status: 409,
				kind: "conflict",
				message: "ana está offline agora.",
			}),
		);
		render(card());
		await userEvent.click(screen.getByRole("button", { name: /Ligar/ }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"ana está offline agora.",
		);
	});

	it("com uma ligação em andamento, fica apagado", () => {
		applyCall(callView());
		render(card());
		expect(screen.getByRole("button", { name: /Ligar/ })).toBeDisabled();
		expect(screen.getByText("Você já está numa ligação.")).toBeInTheDocument();
	});
});

describe("o registro da ligação no histórico", () => {
	beforeEach(() => {
		resetCalls();
		inRoom(false);
	});

	function record(
		outcome: "answered" | "missed" | "declined",
		duration: number | null,
	) {
		return {
			id: "m1",
			channel_id: "d1",
			client_id: "call:c1",
			author: kid,
			body: "Ligação",
			mentions: [],
			created_at: 1_700_000_000,
			kind: "call" as const,
			call: { id: "c1", outcome, duration },
		};
	}

	it("a atendida mostra a duração e o Ligar de novo", () => {
		render(
			<CallEntry
				message={record("answered", 12 * 60 + 4)}
				myId="kid"
				person={ana}
				presence="available"
			/>,
		);
		expect(screen.getByText("Ligação encerrada")).toBeInTheDocument();
		expect(screen.getByText("· 12:04")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Ligar de novo" })).toBeEnabled();
	});

	it("a perdida, para quem não atendeu, é Chamada perdida com Ligar de volta", () => {
		render(
			<CallEntry
				message={record("missed", null)}
				myId="ana"
				person={kid}
				presence={null}
			/>,
		);
		expect(screen.getByText("Chamada perdida")).toBeInTheDocument();
		// Offline: o botão fica apagado.
		expect(
			screen.getByRole("button", { name: "Ligar de volta" }),
		).toBeDisabled();
	});
});

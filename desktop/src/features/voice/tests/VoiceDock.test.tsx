import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	closeSourcePicker,
	openSourcePicker,
	type ScreenShareController,
} from "@/features/screen-share";
import { VoiceDock } from "../components/VoiceDock";
import { useVoice } from "../useVoice";

vi.mock("../useVoice", () => ({ useVoice: vi.fn() }));
// Só o que o `VoiceDock` monta por conta própria importa aqui: o seletor e os avisos.
vi.mock("../components/UserPanel", () => ({ UserPanel: () => null }));
vi.mock("../components/VoiceConnection", () => ({
	VoiceConnection: () => null,
}));
vi.mock("../components/ShareRaceGuard", () => ({ ShareRaceGuard: () => null }));
vi.mock("../components/ShareNotices", () => ({ ShareNotices: () => null }));

const controller = {
	getState: () => ({ status: "idle" }),
	onStateChange: () => () => {},
	listSources: vi.fn(async () => []),
	start: vi.fn(async () => {}),
	stop: async () => {},
	dispose: async () => {},
} satisfies ScreenShareController;

function mockVoice(screenShare: ScreenShareController | null) {
	vi.mocked(useVoice).mockReturnValue({
		voiceChannelId: null,
		room: null,
		screenShare,
	} as never);
}

afterEach(() => {
	act(() => closeSourcePicker());
});

describe("VoiceDock", () => {
	it("desenha o seletor de fonte quando o botão Tela ou um aviso o abre", async () => {
		mockVoice(controller);
		render(<VoiceDock />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

		act(() => openSourcePicker());

		// Sem o `SourcePickerHost` aqui, o store abriria e nada apareceria.
		expect(
			await screen.findByRole("dialog", { name: "Compartilhar tela" }),
		).toBeInTheDocument();
	});

	it("sem a chamada pronta, não há seletor", () => {
		mockVoice(null);
		render(<VoiceDock />);

		act(() => openSourcePicker());

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});

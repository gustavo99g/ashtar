import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	closeSourcePicker,
	openSourcePicker,
	type ScreenShareController,
} from "@/features/screen-share";
import { fakeShareController } from "@/test/fakeShareController";
import { useVoice } from "../../room/hooks/useVoice";

import { VoiceDock } from "../components/VoiceDock";

vi.mock("../../room/hooks/useVoice", () => ({ useVoice: vi.fn() }));
// Só o que o `VoiceDock` monta por conta própria importa aqui: o seletor e os avisos.
vi.mock("../components/UserPanel", () => ({ UserPanel: () => null }));
vi.mock("../components/VoiceConnection", () => ({
	VoiceConnection: () => null,
}));
vi.mock("../../room/components/ShareRaceGuard", () => ({
	ShareRaceGuard: () => null,
}));
vi.mock("../../call/components/ShareNotices", () => ({
	ShareNotices: () => null,
}));
vi.mock("../components/TrayShare", () => ({ TrayShare: () => null }));
// O seletor pede as miniaturas ao Rust, que não existe aqui.
vi.mock("@/lib/tauri/commands", async (importOriginal) => ({
	...(await importOriginal<object>()),
	thumbnailsStart: vi.fn(async () => 1),
	thumbnailsUpdate: vi.fn(async () => {}),
	thumbnailsStop: vi.fn(async () => {}),
}));

const controller = fakeShareController();

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

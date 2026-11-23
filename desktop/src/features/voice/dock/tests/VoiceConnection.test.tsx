import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCameraOn } from "../../camera/hooks/useLocalCamera";
import { useCameraState } from "../../camera/stores/cameraStore";
import { useVoice } from "../../room/hooks/useVoice";
import { VoiceConnection } from "../components/VoiceConnection";

vi.mock("../../room/hooks/useVoice", () => ({ useVoice: vi.fn() }));
vi.mock("../../room/hooks/useRoomName", () => ({
	useConnectedRoomName: () => "Geral",
}));
vi.mock("../hooks/usePing", () => ({ usePing: () => 20 }));
vi.mock("../../camera/hooks/useLocalCamera", () => ({
	setCameraOn: vi.fn(async () => {}),
}));

const ROOM = { name: "sala" };

function renderPanel(room: unknown) {
	vi.mocked(useVoice).mockReturnValue({
		room,
		connectionState: "connected",
		screenShare: null,
		leave: vi.fn(),
		voiceKind: "room",
		voiceTitle: null,
	} as never);
	return render(
		<MemoryRouter>
			<VoiceConnection />
		</MemoryRouter>,
	);
}

afterEach(() => {
	useCameraState.setState({ on: false, busy: false });
	vi.clearAllMocks();
});

describe("a Câmera do painel de voz", () => {
	it("liga e desliga a câmera, como a da barra", async () => {
		renderPanel(ROOM);
		await userEvent.click(screen.getByRole("button", { name: "Ligar câmera" }));
		expect(setCameraOn).toHaveBeenCalledWith(ROOM, true);

		useCameraState.setState({ on: true });
		await userEvent.click(
			await screen.findByRole("button", { name: "Desligar câmera" }),
		);
		expect(setCameraOn).toHaveBeenLastCalledWith(ROOM, false);
	});

	it("sem a sala pronta, fica desativada", () => {
		renderPanel(null);
		expect(screen.getByRole("button", { name: "Ligar câmera" })).toBeDisabled();
	});
});

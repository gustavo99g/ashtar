import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import { createVoiceToken, type UserView } from "@/lib/api";
import { SALA } from "../channel";
import { useVoice } from "../useVoice";
import { VoiceProvider } from "../VoiceProvider";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	createVoiceToken: vi.fn(),
}));

const user: UserView = { id: "u1", nick: "kid", display_name: null, is_owner: false };

/** Mostra o estado da voz e entra na sala ao clicar. */
function Probe() {
	const { voiceChannelId, connectionState, join } = useVoice();
	return (
		<button type="button" onClick={() => join(SALA.id)}>
			{voiceChannelId ?? "fora"} {connectionState}
		</button>
	);
}

afterEach(() => {
	vi.mocked(createVoiceToken).mockReset();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("VoiceProvider", () => {
	it("pede o token da sessão e sai da sala quando a sessão cai", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		// O token nunca chega: o teste para antes de conectar no LiveKit.
		vi.mocked(createVoiceToken).mockReturnValue(new Promise(() => {}));
		render(
			<VoiceProvider>
				<Probe />
			</VoiceProvider>,
		);

		await act(async () => screen.getByRole("button").click());

		expect(createVoiceToken).toHaveBeenCalledWith(SALA.id);
		expect(screen.getByRole("button")).toHaveTextContent(`${SALA.id} connecting`);

		act(() => useSessionStore.setState({ session: { status: "leftGroup", account: null } }));

		expect(screen.getByRole("button")).toHaveTextContent("fora disconnected");
	});

	it("um erro ao pedir o token fica no estado, e entrar de novo tenta outra vez", async () => {
		useSessionStore.setState({ session: { status: "connected", user } });
		vi.mocked(createVoiceToken).mockRejectedValueOnce(new Error("sem rede"));
		render(
			<VoiceProvider>
				<Probe />
			</VoiceProvider>,
		);

		await act(async () => screen.getByRole("button").click());
		expect(screen.getByRole("button")).toHaveTextContent(`${SALA.id} error`);

		vi.mocked(createVoiceToken).mockReturnValue(new Promise(() => {}));
		await act(async () => screen.getByRole("button").click());

		expect(createVoiceToken).toHaveBeenCalledTimes(2);
		expect(screen.getByRole("button")).toHaveTextContent(`${SALA.id} connecting`);
	});
});

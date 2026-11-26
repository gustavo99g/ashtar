import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MuteMark } from "../components/MuteMark";
import { handleVoiceRealtime } from "../realtime";
import { useModeration } from "../../room/stores/moderationStore";
import { QueryClient } from "@tanstack/react-query";

describe("o mute de quem foi moderado", () => {
	it("tem o escudo; o de quem se mutou, não", () => {
		const { rerender } = render(
			<MuteMark member={{ micOff: true }} className="size-3.5" />,
		);
		expect(screen.getByLabelText("microfone desativado")).toBeInTheDocument();
		expect(screen.queryByTitle("Silenciado pela moderação")).toBeNull();
		rerender(<MuteMark member={{ serverMuted: true }} className="size-3.5" />);
		expect(screen.getByLabelText("Silenciado pela moderação")).toBeInTheDocument();
		expect(screen.getByTitle("Silenciado pela moderação")).toBeInTheDocument();
		rerender(<MuteMark member={{}} className="size-3.5" />);
		expect(screen.queryByLabelText(/microfone/)).toBeNull();
	});

	it("o voice.moderated trava sem aviso e guarda a ordem da tela", () => {
		const client = new QueryClient();
		const info = { resumed: false } as Parameters<typeof handleVoiceRealtime>[2];
		handleVoiceRealtime(
			{
				type: "voice.moderated",
				action: "mute",
				server_muted: true,
				server_deafened: false,
				sounds_blocked: false,
				by: "kid",
				by_name: "kid",
			},
			client,
			info,
		);
		expect(useModeration.getState()).toMatchObject({
			serverMuted: true,
			serverDeafened: false,
			notice: null,
		});
		handleVoiceRealtime(
			{
				type: "voice.moderated",
				action: "stop_share",
				server_muted: true,
				server_deafened: false,
				sounds_blocked: false,
				by: "kid",
				by_name: "kid",
			},
			client,
			info,
		);
		expect(useModeration.getState().notice).toEqual({
			action: "stop_share",
			byName: "kid",
		});
	});
});

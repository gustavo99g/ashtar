import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/api";
import { sendRealtime } from "@/lib/realtime";
import { Composer } from "../components/Composer";
import { handleChatRealtime } from "../realtime";
import { useDrafts } from "../stores/draftStore";
import {
	addTyping,
	resetTyping,
	TYPING_TTL_MS,
	typingLabel,
	useTypingStore,
} from "../stores/typingStore";

vi.mock("@/lib/realtime", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/realtime")>()),
	sendRealtime: vi.fn(() => true),
}));

const people = [
	{ id: "ana", nick: "ana", display_name: "Ana" },
	{ id: "bia", nick: "bia", display_name: null },
	{ id: "caio", nick: "caio", display_name: null },
];

function typists(channelId: string) {
	return useTypingStore.getState().byChannel[channelId] ?? [];
}

beforeEach(() => {
	resetTyping();
	useDrafts.setState({ drafts: {} });
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("o digitando", () => {
	it("os três textos da linha", () => {
		expect(typingLabel([])).toBeNull();
		expect(typingLabel(["Ana"])).toBe("Ana está digitando…");
		expect(typingLabel(["Ana", "bia"])).toBe("Ana e bia estão digitando…");
		expect(typingLabel(["Ana", "bia", "caio"])).toBe(
			"várias pessoas estão digitando…",
		);
	});

	it("some 6 segundos depois do último aviso", () => {
		vi.useFakeTimers();
		addTyping("geral", "ana");
		vi.advanceTimersByTime(TYPING_TTL_MS - 1000);
		addTyping("geral", "ana");
		vi.advanceTimersByTime(TYPING_TTL_MS - 1000);
		expect(typists("geral")).toEqual(["ana"]);
		vi.advanceTimersByTime(1000);
		expect(typists("geral")).toEqual([]);
	});

	it("o evento entra, e a mensagem da pessoa apaga na hora", () => {
		const client = new QueryClient();
		const info = { resumed: false };
		handleChatRealtime(
			{ type: "typing", channel_id: "geral", user_id: "ana" },
			client,
			info,
		);
		handleChatRealtime(
			{ type: "typing", channel_id: "geral", user_id: "bia" },
			client,
			info,
		);
		expect(typists("geral")).toEqual(["ana", "bia"]);
		const message = {
			id: "m1",
			channel_id: "geral",
			client_id: "c1",
			author: { id: "ana", nick: "ana", display_name: "Ana", removed: false },
			body: "oi",
			mentions: [],
			created_at: 0,
			kind: "text",
			edited_at: null,
			reply_to: null,
			reactions: [],
			pinned_at: null,
			attachments: [],
			call: null,
		} satisfies Message;
		handleChatRealtime({ type: "message.created", message }, client, info);
		expect(typists("geral")).toEqual(["bia"]);
	});

	it("escrever avisa no máximo de 3 em 3 segundos, e a linha mostra os outros", async () => {
		const user = userEvent.setup();
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Composer
					channelId="geral"
					label="Mensagem para #geral"
					mentionable={people}
					myId="caio"
					onSend={vi.fn()}
				/>
			</QueryClientProvider>,
		);
		await user.type(screen.getByLabelText("Mensagem para #geral"), "oi gente");
		expect(sendRealtime).toHaveBeenCalledTimes(1);
		expect(sendRealtime).toHaveBeenCalledWith({
			type: "typing",
			channel_id: "geral",
		});

		act(() => {
			addTyping("geral", "ana");
			addTyping("geral", "caio");
		});
		// A própria pessoa não aparece.
		expect(screen.getByText("Ana está digitando…")).toBeInTheDocument();
	});
});

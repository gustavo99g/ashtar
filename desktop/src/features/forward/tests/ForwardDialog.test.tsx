import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { channelsKeys } from "@/features/channels";
import { requestForward, useForwardRequest } from "@/features/chat";
import { dmsKeys } from "@/features/dms";
import { useSessionStore } from "@/features/identity";
import {
	type Conversation,
	type Layout,
	listDms,
	type Message,
	sendMessage,
} from "@/lib/api";
import { ForwardDialog } from "../components/ForwardDialog";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listDms: vi.fn(),
	sendMessage: vi.fn(),
}));

const original: Message = {
	id: "m1",
	channel_id: "d-ana",
	client_id: "c1",
	author: { id: "ana", nick: "ana", display_name: "Ana", removed: false },
	body: "olha isso",
	mentions: [],
	created_at: 1,
	kind: "text",
	call: null,
	edited_at: null,
	reply_to: null,
	reactions: [],
	pinned_at: null,
	attachments: [],
	previews: [],
	forwarded: null,
};

const layout: Layout = {
	version: 1,
	top: [],
	categories: [
		{
			id: "texto",
			name: "Texto",
			channels: [
				{
					id: "geral",
					kind: "text",
					name: "geral",
					topic: null,
					category_id: "texto",
					archived_at: null,
					restricted: false,
				},
				{
					id: "memes",
					kind: "text",
					name: "memes",
					topic: null,
					category_id: "texto",
					archived_at: null,
					restricted: false,
				},
			],
		},
	],
};

const conversation = {
	id: "d-bia",
	person: { id: "bia", nick: "bia", display_name: "Beatriz", removed: false },
	last_message: null,
	state: { last_read_id: null, unread: 0, mentions: 0, muted: false },
} as Conversation;

beforeEach(() => {
	useSessionStore.setState({
		session: {
			status: "connected",
			user: { id: "kid", nick: "kid", display_name: null, is_owner: true },
		},
	});
	vi.mocked(listDms).mockResolvedValue([conversation]);
	vi.mocked(sendMessage).mockReset();
	vi.mocked(sendMessage).mockImplementation(
		async (channel, request) =>
			({ ...original, id: request.client_id, channel_id: channel }) as Message,
	);
});

function renderDialog() {
	const client = new QueryClient();
	client.setQueryData(channelsKeys.layout(), layout);
	client.setQueryData(dmsKeys.list(), [conversation]);
	render(
		<QueryClientProvider client={client}>
			<ForwardDialog />
		</QueryClientProvider>,
	);
}

describe("encaminhar", () => {
	it("busca o destino, manda a encaminhada e o comentário logo depois", async () => {
		const user = userEvent.setup();
		renderDialog();
		requestForward(original);
		expect(
			await screen.findByRole("dialog", { name: "Encaminhar mensagem" }),
		).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "Beatriz" })).toBeInTheDocument();
		await user.type(
			screen.getByRole("textbox", { name: "Buscar canal ou conversa" }),
			"mem",
		);
		expect(screen.queryByRole("radio", { name: "geral" })).not.toBeInTheDocument();
		const send = screen.getByRole("button", { name: "Encaminhar" });
		expect(send).toBeDisabled();
		await user.click(screen.getByRole("radio", { name: "memes" }));
		await user.type(
			screen.getByRole("textbox", { name: "Comentário (opcional)" }),
			"kkkk",
		);
		await user.click(send);

		await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
		expect(sendMessage).toHaveBeenNthCalledWith(1, "memes", {
			client_id: expect.any(String),
			body: "olha isso",
			forward: "m1",
		});
		expect(sendMessage).toHaveBeenNthCalledWith(2, "memes", {
			client_id: expect.any(String),
			body: "kkkk",
		});
		expect(useForwardRequest.getState().message).toBeNull();
	});
});

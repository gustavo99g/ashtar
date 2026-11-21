import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFile, hidePreviews, type Message } from "@/lib/api";
import { openLink } from "@/lib/tauri/opener";
import { LinkPreviews } from "../components/LinkPreviews";
import { chatKeys, type MessagePages } from "../queries";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
	hidePreviews: vi.fn(),
}));
vi.mock("@/lib/tauri/opener", () => ({ openLink: vi.fn() }));

const message: Message = {
	id: "m1",
	channel_id: "geral",
	client_id: "c1",
	author: { id: "kid", nick: "kid", display_name: null, removed: false },
	body: "olha https://exemplo.com",
	mentions: [],
	created_at: 1,
	kind: "text",
	call: null,
	edited_at: null,
	reply_to: null,
	reactions: [],
	pinned_at: null,
	attachments: [],
	previews: [
		{
			url: "https://exemplo.com/",
			site: "Exemplo",
			title: "O título",
			description: "A descrição",
			image_id: "img",
		},
	],
};

function renderPreviews(mine: boolean) {
	const client = new QueryClient();
	client.setQueryData<MessagePages>(chatKeys.messages("geral"), {
		pages: [{ messages: [message], has_more: false }],
		pageParams: [null],
	});
	render(
		<QueryClientProvider client={client}>
			<LinkPreviews message={message} mine={mine} />
		</QueryClientProvider>,
	);
	return client;
}

beforeEach(() => {
	URL.createObjectURL = vi.fn(() => "blob:img");
	vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"]));
});

describe("os cartões dos links", () => {
	it("mostram o site, o título e a descrição; o título abre no navegador", async () => {
		const user = userEvent.setup();
		renderPreviews(false);
		expect(screen.getByText("Exemplo")).toBeInTheDocument();
		expect(screen.getByText("A descrição")).toBeInTheDocument();
		await user.click(screen.getByRole("link", { name: "O título" }));
		expect(openLink).toHaveBeenCalledWith("https://exemplo.com/");
		expect(
			screen.queryByRole("button", { name: "Tirar as prévias" }),
		).not.toBeInTheDocument();
		await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledWith("img"));
	});

	it("o autor tira no X, e o cache fica sem eles", async () => {
		const user = userEvent.setup();
		vi.mocked(hidePreviews).mockResolvedValue({ ...message, previews: [] });
		const client = renderPreviews(true);
		await user.click(screen.getByRole("button", { name: "Tirar as prévias" }));
		expect(hidePreviews).toHaveBeenCalledWith("m1");
		expect(
			client.getQueryData<MessagePages>(chatKeys.messages("geral"))?.pages[0]
				.messages[0].previews,
		).toEqual([]);
	});
});

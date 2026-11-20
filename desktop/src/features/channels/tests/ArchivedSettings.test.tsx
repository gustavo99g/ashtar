import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import {
	type Archived,
	getArchivedChannels,
	getChannelLayout,
	unarchiveCategory,
	unarchiveChannel,
} from "@/lib/api";
import { ArchivedSettings } from "../components/ArchivedSettings";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getArchivedChannels: vi.fn(),
	getChannelLayout: vi.fn(),
	unarchiveChannel: vi.fn(),
	unarchiveCategory: vi.fn(),
}));

const NOW = 1_790_000_000;

const archived: Archived = {
	channels: [
		{
			id: "memes",
			kind: "text",
			name: "memes",
			topic: null,
			category_id: null,
			archived_at: NOW,
			restricted: false,
		},
	],
	categories: [{ id: "antiga", name: "Antiga", archived_at: NOW - 86_400 }],
};

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<ArchivedSettings />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	const kid = { id: "kid", nick: "kid", display_name: null, is_owner: true };
	useSessionStore.setState({ session: { status: "connected", user: kid } });
	vi.mocked(getChannelLayout).mockResolvedValue({
		version: 5,
		top: [],
		categories: [],
	});
});

afterEach(() => {
	vi.clearAllMocks();
	useSessionStore.setState({ session: { status: "entering" } });
});

describe("Arquivados", () => {
	it("lista canais e categorias, e Desarquivar devolve e recarrega a lista", async () => {
		vi.mocked(getArchivedChannels)
			.mockResolvedValueOnce(archived)
			.mockResolvedValue({ ...archived, channels: [] });
		vi.mocked(unarchiveChannel).mockResolvedValue();
		const user = userEvent.setup();
		renderPage();

		const list = await screen.findByRole("list", { name: "Arquivados" });
		expect(within(list).getByText("Antiga")).toBeInTheDocument();
		await user.click(
			within(list).getByRole("button", { name: "Desarquivar memes" }),
		);

		expect(unarchiveChannel).toHaveBeenCalledWith("memes");
		await vi.waitFor(() => expect(screen.queryByText("memes")).toBeNull());
		expect(unarchiveCategory).not.toHaveBeenCalled();
	});

	it("sem nada arquivado, diz isso", async () => {
		vi.mocked(getArchivedChannels).mockResolvedValue({
			channels: [],
			categories: [],
		});
		renderPage();

		expect(await screen.findByText("Nada arquivado")).toBeInTheDocument();
	});
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getInviteCard } from "@/lib/api";
import { InviteCards } from "../components/InviteCards";
import { inviteLinksIn } from "../model/inviteLinks";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getInviteCard: vi.fn(),
}));

// Nos testes, a API é a local do desenvolvimento.
const API = "http://127.0.0.1:3000";

describe("inviteLinksIn", () => {
	it("acha o convite do próprio servidor e o do app, sem repetir", () => {
		const found = inviteLinksIn(
			`entra aí ${API}/invite/abcd-efgh-jkmn. ou ashtar://recovery/ABCD-EFGH-JKMP e ${API}/invite/ABCDEFGHJKMN`,
		);
		expect(found.map((f) => [f.invite.kind, f.invite.code, f.url])).toEqual([
			["new", "ABCD-EFGH-JKMN", `${API}/invite/abcd-efgh-jkmn`],
			["recovery", "ABCD-EFGH-JKMP", "ashtar://recovery/ABCD-EFGH-JKMP"],
		]);
	});

	it("ignora o /invite/ de outro site", () => {
		expect(inviteLinksIn("https://discord.gg/invite/ABCDEFGHJKMN")).toEqual([]);
		expect(
			inviteLinksIn("https://exemplo.com/invite/ABCD-EFGH-JKMN"),
		).toEqual([]);
	});
});

function renderCards(body: string) {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<InviteCards body={body} />
		</QueryClientProvider>,
	);
}

describe("InviteCards", () => {
	it("mostra quem convidou e até quando vale", async () => {
		vi.mocked(getInviteCard).mockResolvedValue({
			status: "pending",
			kind: "new",
			person: { nick: "kid", display_name: "Kid" },
			expires_at: Math.floor(Date.now() / 1000) + 600,
		});
		renderCards(`${API}/invite/ABCD-EFGH-JKMN`);
		expect(
			await screen.findByRole("article", { name: "Convite de Kid para o Ashtar" }),
		).toBeTruthy();
		expect(screen.getByText(/^Vale até hoje, /)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Copiar link" })).toBeTruthy();
	});

	it("o convite que não vale mais fica apagado com o motivo", async () => {
		vi.mocked(getInviteCard).mockResolvedValue({
			status: "used",
			kind: "recovery",
			person: { nick: "juliana", display_name: null },
			expires_at: 1,
		});
		renderCards(`${API}/recovery/ABCD-EFGH-JKMN`);
		expect(
			await screen.findByRole("article", {
				name: "Trocar de computador · conta de juliana",
			}),
		).toBeTruthy();
		expect(await screen.findByText("Já foi usado")).toBeTruthy();
	});
});

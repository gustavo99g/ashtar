import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsNew } from "@/lib/tauri/commands";
import { WhatsNewDialog } from "../components/WhatsNewDialog";
import { useUpdaterStore } from "../stores/updaterStore";

vi.mock("@/lib/tauri/commands", () => ({ whatsNew: vi.fn() }));

const notes = "- Visual novo.\n- Cada um tem a sua conta.\n\n  - Com recuo também.\n";

beforeEach(() => {
	localStorage.clear();
	useUpdaterStore.setState({
		whatsNew: null,
		whatsNewOpen: false,
		lastSeenVersion: null,
	});
	vi.mocked(whatsNew).mockReset();
});

describe("WhatsNewDialog", () => {
	it("mostra a versão e um item por linha da seção do CHANGELOG", async () => {
		vi.mocked(whatsNew).mockResolvedValue({ version: "0.2.20", notes });
		render(<WhatsNewDialog />);

		expect(
			await screen.findByRole("dialog", { name: "O que há de novo na 0.2.20" }),
		).toBeInTheDocument();
		const items = screen.getAllByRole("listitem").map((li) => li.textContent);
		// O `- ` do começo some, e a linha em branco não vira item.
		expect(items).toEqual([
			"Visual novo.",
			"Cada um tem a sua conta.",
			"Com recuo também.",
		]);
	});

	it("Entendi fecha e guarda a versão como vista", async () => {
		vi.mocked(whatsNew).mockResolvedValue({ version: "0.2.20", notes });
		render(<WhatsNewDialog />);

		await userEvent.click(await screen.findByRole("button", { name: "Entendi" }));

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(useUpdaterStore.getState().lastSeenVersion).toBe("0.2.20");
	});

	it("o ESC também conta como visto", async () => {
		vi.mocked(whatsNew).mockResolvedValue({ version: "0.2.20", notes });
		render(<WhatsNewDialog />);
		await screen.findByRole("dialog");

		await userEvent.keyboard("{Escape}");

		await waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
		);
		expect(useUpdaterStore.getState().lastSeenVersion).toBe("0.2.20");
	});

	it("uma versão que já foi vista não abre de novo", async () => {
		useUpdaterStore.setState({ lastSeenVersion: "0.2.20" });
		vi.mocked(whatsNew).mockResolvedValue({ version: "0.2.20", notes });
		render(<WhatsNewDialog />);

		await waitFor(() => expect(whatsNew).toHaveBeenCalled());
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("sem notas da versão, não abre", async () => {
		vi.mocked(whatsNew).mockResolvedValue(null);
		render(<WhatsNewDialog />);

		await waitFor(() => expect(whatsNew).toHaveBeenCalled());
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});

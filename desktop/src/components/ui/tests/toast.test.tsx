import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "../toast";

function timerOf(title: string) {
	const item = screen.getByText(title).closest("[data-slot=toast]");
	return item?.querySelector("[data-slot=toast-timer]") as HTMLElement;
}

describe("Toaster", () => {
	afterEach(() => {
		act(() => toast.close());
		vi.restoreAllMocks();
	});

	it("mostra o aviso e fecha quando a barra de tempo acaba", async () => {
		render(<Toaster />);
		act(() => {
			toast.add({ title: "lua entrou no grupo" });
		});
		expect(screen.getByText("lua entrou no grupo")).toBeInTheDocument();

		fireEvent.animationEnd(timerOf("lua entrou no grupo"));

		await waitFor(() => {
			expect(screen.queryByText("lua entrou no grupo")).not.toBeInTheDocument();
		});
	});

	it("pausa a barra quando a janela perde o foco", () => {
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		render(<Toaster />);
		act(() => {
			toast.add({ title: "thi entrou no grupo" });
		});
		expect(timerOf("thi entrou no grupo")).not.toHaveAttribute("data-paused");

		act(() => {
			window.dispatchEvent(new Event("blur"));
		});

		expect(timerOf("thi entrou no grupo")).toHaveAttribute("data-paused");
	});

	it("já nasce pausado se a janela estiver fora de foco (a pessoa está no jogo)", () => {
		vi.spyOn(document, "hasFocus").mockReturnValue(false);
		render(<Toaster />);
		act(() => {
			toast.add({ title: "pedrin entrou no grupo" });
		});

		expect(timerOf("pedrin entrou no grupo")).toHaveAttribute("data-paused");
	});
});

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

	it("o tipo dá a cor da barra e o tempo: o erro fica 12 s, a confirmação curta 4 s e sem o X", () => {
		render(<Toaster />);
		act(() => {
			toast.add({ title: "Não deu para reagir", data: { tone: "error" } });
			toast.add({
				title: "Imagem copiada",
				data: { tone: "success", compact: true },
			});
			toast.add({ title: "lua entrou no grupo" });
		});
		const error = timerOf("Não deu para reagir");
		expect(error).toHaveClass("bg-destructive");
		expect(error.style.animationDuration).toBe("12000ms");

		const copied = timerOf("Imagem copiada");
		expect(copied).toHaveClass("bg-success");
		expect(copied.style.animationDuration).toBe("4000ms");
		const compact = screen
			.getByText("Imagem copiada")
			.closest("[data-slot=toast]");
		expect(compact?.querySelector("[aria-label='Fechar aviso']")).toBeNull();

		// Sem tipo, como antes: dourada e 8 s.
		const plain = timerOf("lua entrou no grupo");
		expect(plain).toHaveClass("bg-gold");
		expect(plain.style.animationDuration).toBe("8000ms");
	});
});

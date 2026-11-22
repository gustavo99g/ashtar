import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { emitInputLevel } from "../../input/model/levelBus";
import { DEFAULT_INPUT, useInputChoice } from "../../input/stores/inputStore";
import { InputModeSection } from "../components/InputModeSection";

beforeEach(() => {
	localStorage.clear();
	useInputChoice.setState(DEFAULT_INPUT);
});

describe("o modo de entrada", () => {
	it("começa na detecção de voz; escolher o pressionar para falar guarda e esconde a sensibilidade", async () => {
		const user = userEvent.setup();
		render(<InputModeSection />);

		expect(screen.getByRole("radio", { name: /Detecção de voz/ })).toBeChecked();
		expect(
			screen.getByRole("switch", {
				name: "Ajustar sensibilidade automaticamente",
			}),
		).toBeChecked();

		await user.click(screen.getByRole("radio", { name: /Pressionar para falar/ }));

		expect(useInputChoice.getState().mode).toBe("ptt");
		expect(
			screen.queryByRole("switch", {
				name: "Ajustar sensibilidade automaticamente",
			}),
		).not.toBeInTheDocument();
	});

	it("sem o automático, a marca dourada vira uma régua que anda com o teclado", async () => {
		const user = userEvent.setup();
		render(<InputModeSection />);
		expect(
			screen.queryByRole("slider", { name: "Sensibilidade" }),
		).not.toBeInTheDocument();

		await user.click(
			screen.getByRole("switch", {
				name: "Ajustar sensibilidade automaticamente",
			}),
		);
		const slider = screen.getByRole("slider", { name: "Sensibilidade" });
		act(() => slider.focus());
		await user.keyboard("{ArrowRight}");

		expect(useInputChoice.getState().autoSensitivity).toBe(false);
		expect(useInputChoice.getState().thresholdDb).toBe(-49);
	});

	it("com o automático, a marca segue o limiar que o portão mede", () => {
		render(<InputModeSection />);
		act(() => emitInputLevel({ level: -40, open: true, threshold: -50 }));

		const bar = screen.getByRole("img", { name: "Sensibilidade automática" });
		const mark = bar.querySelector(".bg-gold") as HTMLElement;
		expect(mark.style.left).toBe("50%");
	});
});

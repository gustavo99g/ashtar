import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TextField } from "../text-field";

describe("TextField", () => {
	it("conta os caracteres enquanto a pessoa digita", async () => {
		render(<TextField label="Nick" maxLength={32} showCount />);

		await userEvent.type(screen.getByLabelText("Nick"), "kid");

		expect(screen.getByText("3/32")).toBeInTheDocument();
	});

	it("liga o erro ao campo para o leitor de tela", () => {
		render(
			<TextField
				label="Nick"
				description="De 2 a 32 caracteres."
				error="Esse nick já está em uso. Tente outro."
			/>,
		);

		const input = screen.getByLabelText("Nick");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAccessibleDescription(
			"Esse nick já está em uso. Tente outro.",
		);
		expect(screen.queryByText("De 2 a 32 caracteres.")).not.toBeInTheDocument();
	});
});

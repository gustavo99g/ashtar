import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PersonName } from "../components/PersonName";

describe("PersonName", () => {
	it("destaca o nome do resto do texto: mais claro e em negrito, sem dourado", () => {
		render(
			<p>
				Conta de <PersonName>juju</PersonName>
			</p>,
		);

		const name = screen.getByText("juju");
		expect(name).toHaveAttribute("data-slot", "person-name");
		expect(name).toHaveClass("text-foreground", "font-semibold");
		expect(name).not.toHaveClass("text-gold");
	});

	it("o dourado é só do dono", () => {
		render(<PersonName owner>kid</PersonName>);

		const name = screen.getByText("kid");
		expect(name).toHaveClass("text-gold");
		expect(name).not.toHaveClass("text-foreground");
		expect(name).toHaveAttribute("data-owner");
	});

	it("deixa a tela trocar o peso, como no título das boas-vindas", () => {
		render(<PersonName className="font-bold">juju</PersonName>);

		const name = screen.getByText("juju");
		expect(name).toHaveClass("font-bold");
		expect(name).not.toHaveClass("font-semibold");
	});
});

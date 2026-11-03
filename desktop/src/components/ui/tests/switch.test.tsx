import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Switch } from "../switch";

function Controlled({ variant }: { variant?: "gold" | "blue" }) {
	const [on, setOn] = useState(false);
	return (
		<Switch
			variant={variant}
			checked={on}
			onCheckedChange={setOn}
			aria-label="Opção"
		/>
	);
}

describe("Switch", () => {
	it("é dourado por padrão", () => {
		render(<Switch checked aria-label="Opção" />);
		const toggle = screen.getByRole("switch", { name: "Opção" });
		expect(toggle.className).toContain("data-checked:bg-gold");
		expect(toggle.className).not.toContain("data-checked:bg-primary");
		expect(screen.getByRole("switch").firstElementChild?.className).toContain(
			"data-checked:bg-gold-foreground",
		);
	});

	it("blue usa o azul do tema, com a bolinha clara", () => {
		render(<Switch variant="blue" checked aria-label="Opção" />);
		const toggle = screen.getByRole("switch", { name: "Opção" });
		expect(toggle.className).toContain("data-checked:bg-primary");
		expect(toggle.className).not.toContain("data-checked:bg-gold");
		expect(toggle.firstElementChild?.className).toContain(
			"data-checked:bg-primary-foreground",
		);
	});

	it("desligado é igual nos dois, e desabilitado ligado usa o tom apagado de cada um", () => {
		render(
			<>
				<Switch aria-label="dourado" disabled checked />
				<Switch variant="blue" aria-label="azul" disabled checked />
			</>,
		);
		const gold = screen.getByRole("switch", { name: "dourado" });
		const blue = screen.getByRole("switch", { name: "azul" });
		for (const toggle of [gold, blue]) {
			expect(toggle.className).toContain("data-unchecked:bg-border-strong");
		}
		expect(gold.className).toContain("data-disabled:data-checked:bg-gold-subtle");
		expect(blue.className).toContain("data-disabled:data-checked:bg-info-subtle");
	});

	it("liga e desliga nas duas variantes, e o className de quem usa continua valendo", async () => {
		const user = userEvent.setup();
		for (const variant of ["gold", "blue"] as const) {
			const { unmount } = render(<Controlled variant={variant} />);
			const toggle = screen.getByRole("switch", { name: "Opção" });
			expect(toggle).not.toBeChecked();
			await user.click(toggle);
			expect(toggle).toBeChecked();
			await user.click(toggle);
			expect(toggle).not.toBeChecked();
			unmount();
		}

		render(<Switch variant="blue" className="ml-2" aria-label="Extra" />);
		expect(screen.getByRole("switch", { name: "Extra" }).className).toContain(
			"ml-2",
		);
	});
});

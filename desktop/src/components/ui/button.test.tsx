import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
	it("chama o onClick quando a pessoa clica", async () => {
		const onClick = vi.fn();
		render(<Button onClick={onClick}>Entrar</Button>);

		await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

		expect(onClick).toHaveBeenCalledOnce();
	});

	it("não chama o onClick quando está desabilitado", async () => {
		const onClick = vi.fn();
		render(
			<Button onClick={onClick} disabled>
				Entrar
			</Button>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

		expect(onClick).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Entrar" })).toBeDisabled();
	});
});

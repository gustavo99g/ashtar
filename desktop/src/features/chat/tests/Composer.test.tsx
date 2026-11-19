import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../components/Composer";
import type { Mentionable } from "../model/mentions";
import { setDraft } from "../stores/draftStore";

const people: Mentionable[] = [
	{ id: "kid", nick: "kid", display_name: null },
	{ id: "a", nick: "ana", display_name: "Ana Lima" },
	{ id: "b", nick: "ana paula", display_name: null },
	{ id: "d", nick: "bia", display_name: null },
];

function renderComposer(onKeyDownOutside = vi.fn()) {
	const onSend = vi.fn();
	render(
		// Só para ver se o Esc escapa do campo.
		<div onKeyDown={onKeyDownOutside}>
			<Composer
				channelId="geral"
				label="Mensagem para #geral"
				mentionable={people}
				myId="kid"
				onSend={onSend}
			/>
		</div>,
	);
	const field = screen.getByRole("textbox", { name: "Mensagem para #geral" });
	return { onSend, field, onKeyDownOutside };
}

function options() {
	return within(screen.getByRole("listbox", { name: "Mencionar" }))
		.getAllByRole("option")
		.map((option) => option.textContent);
}

beforeEach(() => {
	setDraft("geral", "");
});

describe("a sugestão de nicks", () => {
	it("o @ abre a lista sem você; o que vem depois filtra", async () => {
		const user = userEvent.setup();
		const { field } = renderComposer();
		await user.type(field, "oi @");
		// O texto de cada opção começa com a inicial do avatar.
		expect(options()).toEqual(["AAna Lima@ana", "Aana paula@ana paula", "Bbia@bia"]);
		await user.type(field, "b");
		expect(options()).toEqual(["Bbia@bia"]);
	});

	it("as setas andam e o Enter escolhe, sem mandar a mensagem", async () => {
		const user = userEvent.setup();
		const { field, onSend } = renderComposer();
		await user.type(field, "oi @an");
		const listbox = screen.getByRole("listbox");
		expect(field).toHaveAttribute("aria-controls", listbox.id);
		await user.keyboard("{ArrowDown}");
		expect(
			within(listbox).getByRole("option", { selected: true }),
		).toHaveTextContent("ana paula");
		await user.keyboard("{Enter}");

		expect(field).toHaveValue("oi @ana paula ");
		expect(onSend).not.toHaveBeenCalled();
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

		// Com a lista fechada, o Enter manda.
		await user.type(field, "vem{Enter}");
		expect(onSend).toHaveBeenCalledWith("oi @ana paula vem");
	});

	it("o Tab também escolhe, e o clique na opção também", async () => {
		const user = userEvent.setup();
		const { field } = renderComposer();
		await user.type(field, "@bi");
		await user.keyboard("{Tab}");
		expect(field).toHaveValue("@bia ");
		expect(field).toHaveFocus();

		await user.type(field, "e @");
		await user.click(screen.getByRole("option", { name: /Ana Lima/ }));
		expect(field).toHaveValue("@bia e @ana ");
		expect(field).toHaveFocus();
	});

	it("o Esc fecha a lista sem sair do campo; um @ novo abre de novo", async () => {
		const user = userEvent.setup();
		const { field, onKeyDownOutside } = renderComposer();
		await user.type(field, "@an");
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
		expect(onKeyDownOutside).not.toHaveBeenCalledWith(
			expect.objectContaining({ key: "Escape" }),
		);
		await user.type(field, "a");
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
		await user.type(field, " @");
		expect(screen.getByRole("listbox")).toBeInTheDocument();
	});

	it("sem ninguém com esse nome, nada aparece; num e-mail, também não", async () => {
		const user = userEvent.setup();
		const { field } = renderComposer();
		await user.type(field, "@zz");
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
		await user.clear(field);
		await user.type(field, "kid@an");
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
	});
});

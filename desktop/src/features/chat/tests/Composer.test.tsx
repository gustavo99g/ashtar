import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../components/Composer";
import type { Mentionable } from "../model/mentions";
import { clearDraftFiles, useAttachments } from "../stores/attachmentStore";
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
	clearDraftFiles();
	URL.createObjectURL = vi.fn(() => "blob:local");
	URL.revokeObjectURL = vi.fn();
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
		expect(onSend).toHaveBeenCalledWith("oi @ana paula vem", []);
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

describe("os anexos no campo", () => {
	const png = (name: string) => new File(["x"], name, { type: "image/png" });

	it("o + anexa; o cartão mostra o nome e o X tira; com anexo, o texto é opcional", async () => {
		const user = userEvent.setup();
		const { field, onSend } = renderComposer();
		await user.upload(screen.getByLabelText("Escolher arquivos"), [
			png("a.png"),
			png("b.png"),
		]);
		const list = screen.getByRole("list", { name: "Arquivos para enviar" });
		expect(within(list).getByText("a.png")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Tirar a.png" }));
		expect(within(list).queryByText("a.png")).not.toBeInTheDocument();

		await user.type(field, "{Enter}");
		expect(onSend).toHaveBeenCalledWith("", [
			expect.objectContaining({ file: expect.objectContaining({ name: "b.png" }) }),
		]);
		expect(useAttachments.getState().byChannel.geral).toBeUndefined();
		expect(
			screen.queryByRole("list", { name: "Arquivos para enviar" }),
		).not.toBeInTheDocument();
	});

	it("colar um print anexa; passar de 10 avisa", async () => {
		const user = userEvent.setup();
		const { field } = renderComposer();
		field.focus();
		await user.paste({
			files: [png("print.png")],
		} as unknown as DataTransfer);
		expect(screen.getByText("print.png")).toBeInTheDocument();

		await user.upload(
			screen.getByLabelText("Escolher arquivos"),
			Array.from({ length: 10 }, (_, i) => png(`${i}.png`)),
		);
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Uma mensagem leva até 10 arquivos.",
		);
	});
});

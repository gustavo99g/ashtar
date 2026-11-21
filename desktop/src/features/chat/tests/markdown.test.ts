import { describe, expect, it } from "vitest";
import { type MdNode, parseMarkdown, plainText } from "../model/markdown";

const t = (text: string): MdNode => ({ kind: "text", text });

describe("parseMarkdown", () => {
	it("negrito, itálico com * e _, código e spoiler", () => {
		expect(parseMarkdown("**a** *b* _c_ `d` ||e||")).toEqual([
			{ kind: "bold", children: [t("a")] },
			t(" "),
			{ kind: "italic", children: [t("b")] },
			t(" "),
			{ kind: "italic", children: [t("c")] },
			t(" "),
			{ kind: "code", text: "d" },
			t(" "),
			{ kind: "spoiler", children: [t("e")] },
		]);
	});

	it("aninhado", () => {
		expect(parseMarkdown("**_x_**")).toEqual([
			{ kind: "bold", children: [{ kind: "italic", children: [t("x")] }] },
		]);
		expect(parseMarkdown("*um **dois** três*")).toEqual([
			{
				kind: "italic",
				children: [t("um "), { kind: "bold", children: [t("dois")] }, t(" três")],
			},
		]);
	});

	it("sem fechar fica como foi escrito", () => {
		expect(parseMarkdown("**oi")).toEqual([t("**oi")]);
		expect(parseMarkdown("a || b")).toEqual([t("a || b")]);
		expect(parseMarkdown("`solto")).toEqual([t("`solto")]);
	});

	it("no meio de palavras, * e _ não formatam", () => {
		expect(parseMarkdown("2*3*4")).toEqual([t("2*3*4")]);
		expect(parseMarkdown("snake_case_nome")).toEqual([t("snake_case_nome")]);
		expect(parseMarkdown("a * b * c")).toEqual([t("a * b * c")]);
	});

	it("a barra invertida escapa", () => {
		expect(parseMarkdown("\\*\\*não\\*\\*")).toEqual([t("**não**")]);
		expect(parseMarkdown("\\`x\\`")).toEqual([t("`x`")]);
	});

	it("dentro de código não há markdown, menção nem link", () => {
		expect(parseMarkdown("`**@kid** https://x.com`")).toEqual([
			{ kind: "code", text: "**@kid** https://x.com" },
		]);
	});

	it("o link passa inteiro, mesmo com _ e * no meio", () => {
		expect(parseMarkdown("veja https://x.com/a_b_c e _isso_")).toEqual([
			t("veja https://x.com/a_b_c e "),
			{ kind: "italic", children: [t("isso")] },
		]);
	});

	it("o spoiler pode ter link dentro", () => {
		expect(parseMarkdown("||https://x.com/fim||")).toEqual([
			{ kind: "spoiler", children: [t("https://x.com/fim")] },
		]);
	});

	it("o bloco de código, com a linguagem ignorada", () => {
		expect(
			parseMarkdown("antes:\n```bash\nconnect 1.2.3.4\npassword x\n```\ndepois"),
		).toEqual([
			t("antes:"),
			{ kind: "codeblock", text: "connect 1.2.3.4\npassword x" },
			t("depois"),
		]);
		expect(parseMarkdown("```**não**```")).toEqual([
			{ kind: "codeblock", text: "**não**" },
		]);
	});
});

describe("plainText", () => {
	it("tira os marcadores e esconde o spoiler", () => {
		expect(plainText("**final:** ||o vilão era o irmão||")).toBe("final: ▮▮▮");
	});

	it("um spoiler cortado no meio também fica escondido", () => {
		expect(plainText("o fim: ||o vilão era…")).toBe("o fim: ▮▮▮");
	});
});

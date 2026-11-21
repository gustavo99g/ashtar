/**
 * O markdown básico do chat (ADR 0032, decisão 19 do plano da v0.7), lido pelo app e desenhado sem
 * HTML: `**negrito**`, `*itálico*` e `_itálico_`, `` `código` ``, o bloco de três crases (sem
 * cores) e `||spoiler||`. A barra invertida escapa. Dentro de código não há menção, link nem
 * markdown. Os links `http(s)://` passam inteiros (um `_` no meio deles não vira itálico); o resto
 * do texto comum vira link e menção no `bodyParts`.
 *
 * Um marcador sem par fica como foi escrito.
 */

export type MdNode =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "codeblock"; text: string }
	| { kind: "bold" | "italic" | "spoiler"; children: MdNode[] };

type Wrapper = "bold" | "italic" | "spoiler";

/** Os marcadores, do mais longo para o mais curto: `**` antes de `*`. */
const DELIMITERS: readonly [string, Wrapper][] = [
	["||", "spoiler"],
	["**", "bold"],
	["*", "italic"],
	["_", "italic"],
];

/** O que a barra invertida escapa. */
const ESCAPABLE = new Set(["\\", "*", "_", "`", "|", "~", "@", "#", ">"]);

const LINK = /^https?:\/\/[^\s<>]+/i;

function isWord(char: string | undefined): boolean {
	return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function isSpace(char: string | undefined): boolean {
	return char === undefined || /\s/.test(char);
}

/** `*` e `_` não abrem nem fecham no meio de uma palavra (`2*3*4`, `snake_case`). */
function canOpen(text: string, at: number, delimiter: string): boolean {
	if (isSpace(text[at + delimiter.length])) return false;
	if (delimiter.length === 1 && isWord(text[at - 1])) return false;
	return true;
}

function canClose(text: string, at: number, delimiter: string): boolean {
	if (isSpace(text[at - 1])) return false;
	if (delimiter.length === 1 && isWord(text[at + 1])) return false;
	return true;
}

/** Onde fecha o `delimiter` aberto antes de `from`, pulando escapes, código e links. */
function findClose(text: string, from: number, delimiter: string): number {
	let at = from;
	while (at < text.length) {
		const char = text[at];
		if (char === "\\" && ESCAPABLE.has(text[at + 1])) {
			at += 2;
			continue;
		}
		if (char === "`") {
			const end = text.indexOf("`", at + 1);
			if (end > at + 1) {
				at = end + 1;
				continue;
			}
		}
		const link = (at === 0 || isSpace(text[at - 1])) && LINK.exec(text.slice(at));
		if (link) {
			at += link[0].length;
			continue;
		}
		if (text.startsWith(delimiter, at) && at > from && canClose(text, at, delimiter)) {
			// O `*` do itálico não fecha no meio de um `**`.
			if (delimiter === "*" && text[at + 1] === "*") {
				at += 2;
				continue;
			}
			return at;
		}
		// Um `**` dentro do itálico de `*` é um negrito: pula inteiro.
		if (delimiter === "*" && text.startsWith("**", at)) {
			at += 2;
			continue;
		}
		at += 1;
	}
	return -1;
}

function parseInline(text: string): MdNode[] {
	const nodes: MdNode[] = [];
	let buffer = "";
	const flush = () => {
		if (buffer) nodes.push({ kind: "text", text: buffer });
		buffer = "";
	};
	let at = 0;
	outer: while (at < text.length) {
		const char = text[at];
		if (char === "\\" && ESCAPABLE.has(text[at + 1])) {
			buffer += text[at + 1];
			at += 2;
			continue;
		}
		if (char === "`") {
			const end = text.indexOf("`", at + 1);
			if (end > at + 1) {
				flush();
				nodes.push({ kind: "code", text: text.slice(at + 1, end) });
				at = end + 1;
				continue;
			}
		}
		if (at === 0 || isSpace(text[at - 1])) {
			const link = LINK.exec(text.slice(at));
			if (link) {
				buffer += link[0];
				at += link[0].length;
				continue;
			}
		}
		for (const [delimiter, kind] of DELIMITERS) {
			if (!text.startsWith(delimiter, at) || !canOpen(text, at, delimiter)) {
				continue;
			}
			const start = at + delimiter.length;
			const end = findClose(text, start, delimiter);
			if (end < 0) continue;
			flush();
			nodes.push({ kind, children: parseInline(text.slice(start, end)) });
			at = end + delimiter.length;
			continue outer;
		}
		buffer += char;
		at += 1;
	}
	flush();
	return nodes;
}

/** O bloco de código: três crases, com o nome da linguagem na primeira linha ignorado. */
const CODE_BLOCK = /```(?:[\w+#.-]*\n)?([\s\S]*?)```/g;

export function parseMarkdown(body: string): MdNode[] {
	const nodes: MdNode[] = [];
	let last = 0;
	for (const match of body.matchAll(CODE_BLOCK)) {
		// Uma crase escapada antes não abre bloco.
		if (match.index > 0 && body[match.index - 1] === "\\") continue;
		const content = match[1].replace(/^\n/, "").replace(/\n$/, "");
		if (!content.trim()) continue;
		nodes.push(...parseInline(trimBlockEdges(body.slice(last, match.index))));
		nodes.push({ kind: "codeblock", text: content });
		last = match.index + match[0].length;
	}
	nodes.push(...parseInline(last === 0 ? body : trimStartNewline(body.slice(last))));
	return nodes.filter((node) => node.kind !== "text" || node.text !== "");
}

/** A quebra de linha logo antes de um bloco some: o bloco já começa numa linha nova. */
function trimBlockEdges(text: string): string {
	return text.replace(/\n$/, "");
}

function trimStartNewline(text: string): string {
	return text.replace(/^\n/, "");
}

/** O que fica no lugar de um spoiler nos textos sem formatação. */
export const SPOILER_MASK = "▮▮▮";

/**
 * O texto sem os marcadores, para onde não há como desenhar (o aviso do Windows, a citação de uma
 * resposta): o spoiler vira `▮▮▮`. Um `||` sem par (o corte do começo do texto no meio de um
 * spoiler) esconde tudo dali em diante.
 */
export function plainText(body: string): string {
	const flat = (nodes: MdNode[]): string =>
		nodes
			.map((node) => {
				switch (node.kind) {
					case "text":
						return node.text;
					case "code":
					case "codeblock":
						return node.text;
					case "spoiler":
						return SPOILER_MASK;
					default:
						return flat(node.children);
				}
			})
			.join("");
	const text = flat(parseMarkdown(body));
	const open = text.indexOf("||");
	return open < 0 ? text : `${text.slice(0, open)}${SPOILER_MASK}`;
}

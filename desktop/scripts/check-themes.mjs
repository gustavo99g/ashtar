/**
 * Confere os temas (`pnpm check:themes`, também no CI):
 *
 * 1. Cada `src/styles/themes/<id>.css` define todas as variáveis que o `App.css` lê no
 *    `@theme inline` (o contrato) e o `color-scheme`.
 * 2. Cada tema do registro (`themes/index.ts`) tem o arquivo e é importado no `App.css`.
 *
 * Só lê texto, sem rodar o CSS: as listas saem de expressões regulares simples.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(import.meta.dirname, "..", "src", "styles");
const themesDir = join(stylesDir, "themes");
const appCss = readFileSync(join(stylesDir, "App.css"), "utf8");

const themeInline = appCss.match(/@theme inline\s*\{([\s\S]*?)\n\}/);
if (!themeInline) {
	console.error("App.css: não achei o bloco @theme inline.");
	process.exit(1);
}
const contract = new Set(
	[...themeInline[1].matchAll(/var\(--([a-z0-9-]+)\)/g)].map(
		(match) => match[1],
	),
);

const registry = readFileSync(join(themesDir, "index.ts"), "utf8");
const registeredIds = [...registry.matchAll(/id:\s*"([a-z0-9-]+)"/g)].map(
	(match) => match[1],
);

const problems = [];

for (const file of readdirSync(themesDir).filter((name) =>
	name.endsWith(".css"),
)) {
	const id = file.replace(/\.css$/, "");
	const css = readFileSync(join(themesDir, file), "utf8");
	const declared = new Set(
		[...css.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
	);

	if (!css.includes(`[data-theme="${id}"]`)) {
		problems.push(`${file}: o seletor tem que ser [data-theme="${id}"].`);
	}
	if (!/color-scheme\s*:/.test(css)) {
		problems.push(`${file}: falta o color-scheme.`);
	}
	for (const token of contract) {
		if (!declared.has(token)) {
			problems.push(`${file}: falta --${token}.`);
		}
	}
	for (const token of declared) {
		if (!contract.has(token)) {
			problems.push(`${file}: --${token} não está no contrato do App.css.`);
		}
	}
	if (!registeredIds.includes(id)) {
		problems.push(`${file}: o tema não está no registro (themes/index.ts).`);
	}
}

for (const id of registeredIds) {
	if (!appCss.includes(`@import "./themes/${id}.css";`)) {
		problems.push(`App.css: falta @import "./themes/${id}.css";`);
	}
}

if (problems.length > 0) {
	console.error(problems.join("\n"));
	process.exit(1);
}

console.log(
	`Temas ok: ${registeredIds.join(", ")} (${contract.size} tokens no contrato).`,
);

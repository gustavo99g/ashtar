// Move arquivos de `src/` e reescreve os imports que apontam para eles (relativos e `@/`), inclusive
// nos `vi.mock` e nos `import()`. Uso: node scripts/move-files.mjs mapa.json
// O mapa é { "caminho/antigo.ts": "caminho/novo.ts" }, relativo a `src/`.
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const mapFile = process.argv[2];
if (!mapFile) {
	console.error("uso: node scripts/move-files.mjs mapa.json");
	process.exit(1);
}
const abs = (p) => path.join(SRC, p);
const moves = new Map(
	Object.entries(JSON.parse(fs.readFileSync(mapFile, "utf8"))).map(
		([from, to]) => [path.normalize(abs(from)), path.normalize(abs(to))],
	),
);
for (const from of moves.keys()) {
	if (!fs.existsSync(from)) throw new Error(`não existe: ${from}`);
}
for (const to of moves.values()) {
	if (fs.existsSync(to)) throw new Error(`já existe: ${to}`);
}

const EXT = [".ts", ".tsx", ".js", ".jsx", ".css", ".svg", ".json"];
const TRY = ["", ...EXT, ...EXT.map((e) => `/index${e}`)];

function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "generated") walk(full, out);
		} else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
	}
	return out;
}

/** O arquivo real a que um caminho (sem extensão, talvez) aponta. */
function resolveFile(base) {
	for (const suffix of TRY) {
		const candidate = base + suffix;
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
			return candidate;
		}
	}
	return null;
}

const SPEC =
	/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|importActual|doMock|unmock|requireActual)\(\s*)(["'])([^"'\n]+)\2/g;

const files = walk(SRC);
const edits = new Map();

for (const file of files) {
	const newFile = moves.get(path.normalize(file)) ?? file;
	const original = fs.readFileSync(file, "utf8");
	const next = original.replace(SPEC, (whole, lead, quote, spec) => {
		const [bare, query = ""] = spec.split(/(?=\?)/);
		let target = null;
		if (bare.startsWith(".")) {
			target = resolveFile(path.resolve(path.dirname(file), bare));
		} else if (bare.startsWith("@/")) {
			target = resolveFile(path.join(SRC, bare.slice(2)));
		}
		if (!target) return whole;
		const newTarget = moves.get(path.normalize(target)) ?? target;
		if (newTarget === target && newFile === file) return whole;

		// Mantém o jeito de escrever: sem extensão, a menos que o original tivesse.
		const hadExt = EXT.includes(path.extname(bare));
		const viaIndex = /[\\/]index\.[a-z]+$/.test(target) && !/index(\.[a-z]+)?$/.test(bare);
		let rewritten = viaIndex ? path.dirname(newTarget) : newTarget;
		if (!hadExt && !viaIndex) rewritten = rewritten.replace(/\.(ts|tsx)$/, "");

		let result;
		if (bare.startsWith("@/")) {
			result = `@/${path.relative(SRC, rewritten).split(path.sep).join("/")}`;
		} else {
			result = path
				.relative(path.dirname(newFile), rewritten)
				.split(path.sep)
				.join("/");
			if (!result.startsWith(".")) result = `./${result}`;
		}
		return `${lead}${quote}${result}${query}${quote}`;
	});
	if (next !== original) edits.set(file, next);
}

for (const [file, content] of edits) fs.writeFileSync(file, content);
for (const [from, to] of moves) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.renameSync(from, to);
}
console.log(`${moves.size} arquivos movidos, ${edits.size} reescritos`);

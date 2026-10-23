import { matchRoutes, type RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { paths } from "@/lib/paths";
import { routes } from "./router";

const SAMPLE_CODE = "ABCD-EFGH-JK00";

/** A rota mais funda que casou, a da tela. */
function last(matches: ReturnType<typeof matchRoutes>) {
	return matches?.[matches.length - 1];
}

/** Todo endereço de `paths`, com um código de exemplo nos que pedem um. */
function allPaths(node: unknown): string[] {
	if (typeof node === "string") return [node];
	if (typeof node === "function") return [node(SAMPLE_CODE) as string];
	return Object.values(node as object).flatMap(allPaths);
}

/** O caminho completo de cada rota que mostra uma tela (as de layout, sem caminho, só repassam). */
function leafPaths(list: RouteObject[], parent = ""): string[] {
	return list.flatMap((route) => {
		const own = route.path ?? "";
		const full = own.startsWith("/")
			? own
			: `${parent}/${own}`.replace(/\/+/g, "/");
		const base = full === "" ? "/" : full;
		if (route.children) return leafPaths(route.children, base);
		return route.index ? [] : [base.replace(/\/$/, "") || "/"];
	});
}

describe("rotas do app", () => {
	it.each(allPaths(paths))("%s tem rota", (path) => {
		const matches = matchRoutes(routes, path);

		expect(matches, `sem rota para ${path}`).not.toBeNull();
		// A última rota que casou é a da tela, não só um layout.
		expect(last(matches)?.route.element).toBeDefined();
	});

	it("toda rota de tela tem um endereço em `paths`", () => {
		const known = allPaths(paths).map((path) =>
			path.replace(SAMPLE_CODE, ":code"),
		);

		for (const path of leafPaths(routes)) {
			expect(known, `${path} está no router mas não em paths`).toContain(path);
		}
	});

	it("o código do convite vai como parâmetro", () => {
		const matches = matchRoutes(routes, paths.entry.invite(SAMPLE_CODE));

		expect(last(matches)?.params.code).toBe(SAMPLE_CODE);
	});

	it("o código com caracteres especiais é escapado e volta inteiro", () => {
		const matches = matchRoutes(routes, paths.entry.recovery("a b/c"));

		expect(last(matches)?.params.code).toBe("a b/c");
	});

	it("as configurações abrem no perfil", () => {
		const matches = matchRoutes(routes, paths.settings.root);

		expect(last(matches)?.route.index).toBe(true);
	});

	it("um endereço que não existe não casa com nada", () => {
		expect(matchRoutes(routes, "/entrada/convite/abc")).toBeNull();
		expect(matchRoutes(routes, "/nao-existe")).toBeNull();
	});
});

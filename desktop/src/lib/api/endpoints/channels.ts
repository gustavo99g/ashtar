/**
 * A lista de canais e categorias (ADR 0016).
 */
import { apiJson } from "../client";
import type { Layout } from "../generated";

/** `GET /api/channels`: o topo e as categorias, cada uma com os seus canais, e a versão. */
export function getChannelLayout(): Promise<Layout> {
	return apiJson<Layout>("/api/channels");
}

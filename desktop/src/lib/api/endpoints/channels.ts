/**
 * A lista de canais e categorias (ADR 0016). Ler é de todo membro; o resto responde `forbidden`
 * (403) a quem não tem "Gerenciar canais".
 */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type {
	Archived,
	CategoryRequest,
	ChannelView,
	CreateChannelRequest,
	Layout,
	LayoutRequest,
	UpdateChannelRequest,
} from "../generated";

function channelPath(id: string, rest = ""): string {
	return `/api/channels/${encodeURIComponent(id)}${rest}`;
}

function categoryPath(id: string, rest = ""): string {
	return `/api/categories/${encodeURIComponent(id)}${rest}`;
}

/** `GET /api/channels`: o topo e as categorias, cada uma com os seus canais, e a versão. */
export function getChannelLayout(): Promise<Layout> {
	return apiJson<Layout>("/api/channels");
}

/** `GET /api/channels/archived`: o que está arquivado, do mais recente para o mais antigo. */
export function getArchivedChannels(): Promise<Archived> {
	return apiJson<Archived>("/api/channels/archived");
}

/**
 * `PUT /api/channels/layout`: a ordem nova, com a versão que o app tinha. Outra pessoa mudou antes:
 * `conflict` (409).
 */
export function setChannelLayout(request: LayoutRequest): Promise<Layout> {
	return apiJson<Layout>("/api/channels/layout", jsonRequest("PUT", request));
}

/** `POST /api/channels`: um canal de texto novo, no fim da categoria (ou do topo). */
export function createChannel(
	request: CreateChannelRequest,
): Promise<ChannelView> {
	return apiJson<ChannelView>("/api/channels", jsonRequest("POST", request));
}

/** `PATCH /api/channels/{id}`: nome e tópico (texto vazio tira o tópico). */
export function updateChannel(
	id: string,
	request: UpdateChannelRequest,
): Promise<ChannelView> {
	return apiJson<ChannelView>(channelPath(id), jsonRequest("PATCH", request));
}

/** `POST /api/channels/{id}/archive`. O `#geral` e a Sala: `invalid_request`. */
export async function archiveChannel(id: string): Promise<void> {
	await apiFetch(channelPath(id, "/archive"), { method: "POST" });
}

export async function unarchiveChannel(id: string): Promise<void> {
	await apiFetch(channelPath(id, "/unarchive"), { method: "POST" });
}

/** `POST /api/categories`: devolve a lista inteira, já com a categoria nova no fim. */
export function createCategory(request: CategoryRequest): Promise<Layout> {
	return apiJson<Layout>("/api/categories", jsonRequest("POST", request));
}

export async function renameCategory(
	id: string,
	request: CategoryRequest,
): Promise<void> {
	await apiFetch(categoryPath(id), jsonRequest("PATCH", request));
}

/** `POST /api/categories/{id}/archive`: os canais dela vão para o topo. */
export async function archiveCategory(id: string): Promise<void> {
	await apiFetch(categoryPath(id, "/archive"), { method: "POST" });
}

export async function unarchiveCategory(id: string): Promise<void> {
	await apiFetch(categoryPath(id, "/unarchive"), { method: "POST" });
}

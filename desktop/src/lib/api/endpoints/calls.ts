/**
 * As ligações privadas (ADR 0023): ligar, atender, recusar, desistir e desligar, sempre dentro de
 * uma conversa. A voz é a da sala de sempre (`voice.ts`), com o id da conversa no lugar da sala.
 */
import { apiFetch, apiJson } from "../client";
import type { CallView } from "../generated";

const base = (dmId: string) => `/api/dms/${encodeURIComponent(dmId)}/call`;

/**
 * `POST /api/dms/{id}/call`: começa a tocar para a outra pessoa. Se ela já estava chamando, vale
 * como atender (a ligação volta `answered`). Rejeita com `conflict` se ela está offline ou se você
 * já está noutra ligação.
 */
export function startCall(dmId: string): Promise<CallView> {
	return apiJson<CallView>(base(dmId), { method: "POST" });
}

/** `POST /api/dms/{id}/call/accept`: atende a ligação que está tocando para você. */
export function acceptCall(dmId: string): Promise<CallView> {
	return apiJson<CallView>(`${base(dmId)}/accept`, { method: "POST" });
}

/** O que encerrar quer dizer: recusar, desistir de chamar ou desligar. */
export type CallHangup = "decline" | "cancel" | "end";

/** `POST /api/dms/{id}/call/{decline|cancel|end}`. O fim chega aos dois pelo `call.ended`. */
export async function hangUpCall(dmId: string, how: CallHangup): Promise<void> {
	await apiFetch(`${base(dmId)}/${how}`, { method: "POST" });
}

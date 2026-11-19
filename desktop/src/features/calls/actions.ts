/**
 * O que a pessoa faz com a ligação: ligar, atender, recusar, desistir e desligar. Cada ação chama
 * a API e, quando a resposta já diz como a ligação ficou, põe no store sem esperar o tempo real (o
 * evento que chega depois é o mesmo e não muda nada).
 *
 * Os erros voltam para quem chamou: o botão mostra a mensagem da API ("Ana está offline agora.").
 */
import { acceptCall, hangUpCall, startCall } from "@/lib/api";
import { applyCall, useCallStore } from "./stores/callStore";

/** Liga para a outra pessoa da conversa `dmId`. */
export async function callPerson(dmId: string): Promise<void> {
	applyCall(await startCall(dmId));
}

/** Atende a ligação que está tocando. */
export async function acceptRinging(): Promise<void> {
	const { call, phase } = useCallStore.getState();
	if (!call || phase !== "ringing") return;
	applyCall(await acceptCall(call.channel_id));
}

/** Recusa a ligação que está tocando. */
export async function declineRinging(): Promise<void> {
	const { call, phase } = useCallStore.getState();
	if (!call || phase !== "ringing") return;
	await hangUpCall(call.channel_id, "decline");
}

/** Desiste de chamar, antes de atenderem. */
export async function cancelCalling(): Promise<void> {
	const { call, phase } = useCallStore.getState();
	if (!call || phase !== "calling") return;
	await hangUpCall(call.channel_id, "cancel");
}

/** Desliga a ligação (ou, tocando, recusa ou desiste, conforme o lado). */
export async function hangUp(): Promise<void> {
	const { call } = useCallStore.getState();
	if (!call) return;
	await hangUpCall(call.channel_id, "end");
}

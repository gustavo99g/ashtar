/**
 * A ligação desta tela (`model/machine.ts`), num store do zustand: o tempo real, as respostas da
 * API e o `CallBridge` escrevem; os componentes leem. Fica só na memória: a ligação em andamento
 * volta pelo `ready`, e a perdida, pelo histórico.
 */
import { create } from "zustand";
import type { CallOutcome, CallView } from "@/lib/api";
import {
	type CallMachine,
	IDLE,
	withCall,
	withConnected,
	withEnded,
	withoutEnded,
	withoutMissed,
	withReady,
	withReturnRoom,
} from "../model/machine";

export const useCallStore = create<CallMachine>()(() => IDLE);

export function applyCall(call: CallView): void {
	useCallStore.setState((state) => withCall(state, call));
}

export function applyReady(me: string, call: CallView | null): void {
	useCallStore.setState((state) => withReady(state, me, call));
}

export function applyEnded(ended: {
	call_id: string;
	channel_id: string;
	outcome: CallOutcome;
	duration: number | null;
}): void {
	useCallStore.setState((state) => withEnded(state, ended));
}

export function markConnected(): void {
	useCallStore.setState(withConnected);
}

export function setReturnRoom(returnRoom: string | null): void {
	useCallStore.setState((state) => withReturnRoom(state, returnRoom));
}

export function dismissEnded(): void {
	useCallStore.setState(withoutEnded);
}

export function clearMissed(channelId: string): void {
	useCallStore.setState((state) => withoutMissed(state, channelId));
}

/** Ao sair da conta, e nos testes. */
export function resetCalls(): void {
	useCallStore.setState(IDLE, true);
}

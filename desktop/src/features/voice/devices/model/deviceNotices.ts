/**
 * Os avisos dos dispositivos na chamada (v0.6, decisão 12 do PLAN): o escolhido sumiu (e a chamada
 * passou para o padrão do Windows), ele voltou (o aviso some), e um microfone apareceu quando a
 * pessoa estava sem nenhum (o aviso oferece ativar). Só as regras, comparando o antes com o agora.
 */
import type { DeviceKind } from "./devices";

/** O que os avisos olham, a cada mudança da lista ou da escolha. */
export interface DeviceStatus {
	/** O escolhido está desconectado, e a chamada usa o padrão do Windows no lugar. */
	missing: Record<DeviceKind, boolean>;
	/** Quantos microfones há, ou `null` quando a lista não serve para dizer. */
	inputs: number | null;
}

export type DeviceNotice =
	| { kind: "missing"; device: DeviceKind }
	| { kind: "back"; device: DeviceKind }
	/** Apareceu um microfone, e a pessoa entrou sem nenhum. */
	| { kind: "microphoneFound" };

const KINDS: readonly DeviceKind[] = ["input", "output"];

export function deviceNotices(
	previous: DeviceStatus,
	next: DeviceStatus,
): DeviceNotice[] {
	const notices: DeviceNotice[] = [];
	for (const device of KINDS) {
		if (!previous.missing[device] && next.missing[device]) {
			notices.push({ kind: "missing", device });
		} else if (previous.missing[device] && !next.missing[device]) {
			notices.push({ kind: "back", device });
		}
	}
	if (previous.inputs === 0 && next.inputs !== null && next.inputs > 0) {
		notices.push({ kind: "microphoneFound" });
	}
	return notices;
}

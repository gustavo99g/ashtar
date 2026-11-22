/**
 * O último status que este computador viu da pessoa, para o painel abrir já com ele antes de o
 * `GET /api/me` responder. Quem manda é a API: isto é só a memória da última resposta.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Status } from "@/lib/api";
import { isStatus } from "../model/status";

interface LastStatus {
	last: Status;
}

export const useLastStatus = create<LastStatus>()(
	persist(() => ({ last: "available" as Status }), {
		name: "ashtar-status",
		version: 1,
		// Um valor estranho no disco volta para o padrão.
		merge: (persisted, current) => {
			const saved = (persisted as Partial<LastStatus> | undefined)?.last;
			return { ...current, last: isStatus(saved) ? saved : "available" };
		},
	}),
);

export function rememberStatus(status: Status): void {
	if (useLastStatus.getState().last !== status) useLastStatus.setState({ last: status });
}

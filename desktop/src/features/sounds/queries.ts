import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useOptionalMe, useSession } from "@/features/identity";
import { listPendingSounds, listSounds } from "@/lib/api";
import { clearSounds, setPendingSounds, setSounds } from "./stores/soundsStore";

export const soundsKeys = {
	all: () => ["sounds"] as const,
	approved: () => ["sounds", "approved"] as const,
	mine: () => ["sounds", "mine"] as const,
	pending: () => ["sounds", "pending"] as const,
};

/**
 * Carrega os aprovados ao entrar (o `AppShell` monta) e, para quem aprova, o tamanho da fila.
 * Depois quem mantém em dia é o `sounds.changed` e o `sounds.queue`.
 */
export function useLoadSounds(): void {
	const connected = useSession().status === "connected";
	const canApprove = useOptionalMe()?.can_approve_sounds === true;
	const approved = useQuery({
		queryKey: soundsKeys.approved(),
		queryFn: listSounds,
		enabled: connected,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const pending = useQuery({
		queryKey: soundsKeys.pending(),
		queryFn: listPendingSounds,
		enabled: connected && canApprove,
	});
	useEffect(() => {
		if (approved.data) setSounds(approved.data);
	}, [approved.data]);
	useEffect(() => {
		if (pending.data) setPendingSounds(pending.data.length);
	}, [pending.data]);
	useEffect(() => {
		if (!connected) clearSounds();
	}, [connected]);
}

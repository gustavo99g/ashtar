import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useOptionalMe, useSession } from "@/features/identity";
import {
	approveSound,
	createSound,
	deleteSound,
	listMySounds,
	listPendingSounds,
	listSounds,
	rejectSound,
	updateSound,
	uploadFile,
} from "@/lib/api";
import { encodeWav, SAMPLE_RATE } from "./model/audio";
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

/** Os sons que a pessoa enviou, em qualquer situação. */
export function useMySounds() {
	return useQuery({ queryKey: soundsKeys.mine(), queryFn: listMySounds });
}

/** A fila de aprovação (só com "Aprovar sons"). */
export function usePendingSoundList(enabled: boolean) {
	return useQuery({
		queryKey: soundsKeys.pending(),
		queryFn: listPendingSounds,
		enabled,
	});
}

/** Depois de mudar um som: a lista da pessoa e a fila buscam de novo. */
function useRefresh() {
	const client = useQueryClient();
	return () => {
		void client.invalidateQueries({ queryKey: soundsKeys.mine() });
		void client.invalidateQueries({ queryKey: soundsKeys.pending() });
	};
}

export interface NewSound {
	/** O trecho já editado, mono de 48 kHz. */
	samples: Float32Array;
	name: string;
	emoji: string | null;
	/** O som (aguardando ou recusado) que este substitui. */
	replaces?: string;
}

/** Gera o WAV, envia o arquivo e cria o som. */
export function useCreateSound() {
	const refresh = useRefresh();
	return useMutation({
		mutationFn: async ({ samples, name, emoji, replaces }: NewSound) => {
			const wav = new Blob([encodeWav(samples, SAMPLE_RATE)], {
				type: "audio/wav",
			});
			const file = await uploadFile(wav, {
				kind: "sound",
				name: `${name}.wav`,
				durationMs: Math.round((samples.length / SAMPLE_RATE) * 1000),
			});
			return createSound({
				file_id: file.id,
				name,
				...(emoji ? { emoji } : {}),
				...(replaces ? { replaces } : {}),
			});
		},
		onSuccess: refresh,
	});
}

export function useUpdateSound() {
	const refresh = useRefresh();
	return useMutation({
		mutationFn: ({
			id,
			name,
			emoji,
		}: {
			id: string;
			name: string;
			emoji: string | null;
		}) => updateSound(id, { name, ...(emoji ? { emoji } : {}) }),
		onSuccess: refresh,
	});
}

export function useDeleteSound() {
	const refresh = useRefresh();
	return useMutation({
		mutationFn: (id: string) => deleteSound(id),
		onSuccess: refresh,
	});
}

export function useReviewSound() {
	const refresh = useRefresh();
	return useMutation({
		mutationFn: ({
			id,
			approve,
			reason,
		}: {
			id: string;
			approve: boolean;
			reason?: string;
		}) => (approve ? approveSound(id) : rejectSound(id, reason)),
		onSuccess: refresh,
	});
}

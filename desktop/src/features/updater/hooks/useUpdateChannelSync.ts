import { useEffect } from "react";
import { useMe } from "@/features/identity";
import { setUpdateChannel } from "@/lib/tauri/commands";

/**
 * Passa ao Rust o canal de atualização que a API mandou (ADR 0013).
 *
 * Roda a cada resposta do `/api/me` com um canal diferente: no login e quando o dono liga ou
 * desliga o beta desta pessoa (o `useMe` busca de novo quando a janela volta a aparecer, ou quando
 * uma tela o pede, com os dados de mais de 30 s). O Rust guarda o canal na memória e, se passou
 * para o beta, verifica na hora.
 *
 * Fica na `features/updater`, e não na `identity`: o canal é assunto da atualização, e a
 * dependência anda num sentido só (a `updater` lê o `useMe`; a `identity` não sabe do updater).
 */
export function useUpdateChannelSync() {
	const channel = useMe().data?.update_channel;

	useEffect(() => {
		if (!channel) return;
		// Uma falha já está no log do Rust, e o próximo `/api/me` tenta de novo.
		setUpdateChannel(channel).catch(() => {});
	}, [channel]);
}

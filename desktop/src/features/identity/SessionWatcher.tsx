import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useVoice } from "@/features/voice";
import { setSessionHandlers } from "@/lib/api";
import { reauthenticate, setLeftGroup } from "./session";

/**
 * Liga a sessão ao `lib/api`: registra como entrar de novo depois de um 401 e o que fazer quando
 * este computador saiu do grupo. Não desenha nada.
 *
 * Fica no `App`, dentro do `QueryClientProvider` e do `VoiceProvider` (limpa o cache e derruba a
 * chamada). O router fica abaixo dele, então quem navega é o `onLeftGroup` que o `App` passa.
 */
export function SessionWatcher({ onLeftGroup }: { onLeftGroup: () => void }) {
	const queryClient = useQueryClient();
	const { leave } = useVoice();

	useEffect(
		() =>
			setSessionHandlers({
				reauthenticate,
				onLeftGroup: () => {
					leave();
					// Antes de limpar o cache: com a sessão fora de "conectado", o `useMe` de quem ainda
					// estiver na tela não busca de novo.
					setLeftGroup();
					onLeftGroup();
					queryClient.clear();
				},
			}),
		[queryClient, leave, onLeftGroup],
	);

	return null;
}

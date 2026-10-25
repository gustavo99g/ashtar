import { useCallback, useEffect, useRef, useState } from "react";
import {
	checkForUpdate,
	installUpdate,
	isAppError,
	onUpdateFailed,
	onUpdateReady,
	pendingUpdate,
} from "@/lib/tauri/commands";

/**
 * O "Atualizar agora" da entrada (`client_outdated`): verifica, espera o download e reinicia.
 *
 * Usa os comandos do updater que já existem: a verificação (`checkForUpdate`) só pede, e o
 * resultado chega pelos eventos. Se a versão já foi baixada (o próprio 426 pede uma verificação),
 * instala direto. Sem versão nova, sem rede ou no desenvolvimento, o Rust não avisa nada: depois
 * de dois minutos sem notícia, a espera acaba com um recado.
 */

/** `checking`: procurando e baixando; `installing`: instalando, e o app vai fechar. */
export type UpdateNowState =
	| { status: "idle" }
	| { status: "checking" }
	| { status: "installing" }
	| { status: "failed"; message: string };

/** Quanto esperar pela versão nova, que pode estar baixando (o instalador tem uns 10 MB). */
export const UPDATE_WAIT_MS = 120_000;

export const UPDATE_NOT_FOUND =
	"Não achamos a versão nova ainda. Tente de novo daqui a pouco.";

export function useUpdateNow() {
	const [state, setState] = useState<UpdateNowState>({ status: "idle" });
	// Para de escutar a espera em andamento (ao sair da tela ou ao começar outra).
	const stop = useRef<(() => void) | null>(null);

	useEffect(() => () => stop.current?.(), []);

	const start = useCallback(() => {
		stop.current?.();
		setState({ status: "checking" });

		let done = false;
		const listening = [
			onUpdateReady(() => install()),
			onUpdateFailed(({ message }) => fail(message)),
		];
		const timer = setTimeout(() => fail(UPDATE_NOT_FOUND), UPDATE_WAIT_MS);

		function finish() {
			done = true;
			clearTimeout(timer);
			for (const unlisten of listening)
				void unlisten.then((unlistenFn) => unlistenFn());
		}
		function fail(message: string) {
			if (done) return;
			finish();
			setState({ status: "failed", message });
		}
		function install() {
			if (done) return;
			finish();
			setState({ status: "installing" });
			// Se der certo, não volta: o app fecha e abre na versão nova.
			installUpdate().catch((error: unknown) => {
				setState({
					status: "failed",
					message: isAppError(error) ? error.message : String(error),
				});
			});
		}

		stop.current = finish;
		// Só pergunta depois de escutar: o aviso de "pronta" não pode passar antes.
		Promise.all(listening)
			.then(() => pendingUpdate())
			.then((version) => (version ? install() : checkForUpdate()))
			.catch((error: unknown) =>
				fail(isAppError(error) ? error.message : String(error)),
			);
	}, []);

	return { state, start };
}

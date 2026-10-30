/**
 * Aviso de atualização (decisão 6 do PLAN): "Atualização pronta — reiniciar" quando o Rust termina de
 * baixar uma versão, e a falha de assinatura ou de instalação.
 *
 * Mínimo de propósito: o resto da UI de atualização (canal beta, pasta de logs) vem com a UI nova
 * (v0.2.2). Reiniciar durante uma chamada pede confirmação; sem o clique, a versão é instalada ao
 * fechar o app (no Rust).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useVoice } from "@/features/voice";
import {
	installUpdate,
	isAppError,
	onUpdateFailed,
	onUpdateReady,
	pendingUpdate,
} from "@/lib/tauri/commands";
import { useUpdateChannelSync } from "./useUpdateChannelSync";

type Notice =
	| { kind: "ready"; version: string }
	| { kind: "failed"; message: string };

export function UpdateNotice() {
	// O aviso fica montado o tempo todo, no `App`: é ele que leva ao Rust o canal da API.
	useUpdateChannelSync();
	const { connectionState } = useVoice();
	const [notice, setNotice] = useState<Notice | null>(null);
	const [installing, setInstalling] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const unlisteners = [
			onUpdateReady(({ version }) => setNotice({ kind: "ready", version })),
			onUpdateFailed(({ message }) => setNotice({ kind: "failed", message })),
		];

		// A versão pode ter ficado pronta antes de este componente começar a escutar.
		void pendingUpdate().then((version) => {
			if (!cancelled && version) {
				setNotice((current) => current ?? { kind: "ready", version });
			}
		});

		return () => {
			cancelled = true;
			for (const unlisten of unlisteners) {
				void unlisten.then((stop) => stop());
			}
		};
	}, []);

	if (!notice) {
		return null;
	}

	async function restart() {
		const inCall =
			connectionState !== "disconnected" && connectionState !== "error";
		if (
			inCall &&
			!window.confirm("Reiniciar agora tira você da chamada. Continuar?")
		) {
			return;
		}

		setInstalling(true);
		try {
			await installUpdate();
		} catch (error) {
			setInstalling(false);
			setNotice({
				kind: "failed",
				message: isAppError(error) ? error.message : String(error),
			});
		}
	}

	return (
		<div
			role="status"
			className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-md border border-line bg-float px-4 py-3 text-sm text-primary shadow-lg"
		>
			{notice.kind === "ready" ? (
				<>
					<div className="flex flex-col">
						<span className="font-semibold">
							Atualização pronta ({notice.version})
						</span>
						<span className="text-xs text-muted">
							Ou feche o app: ela é instalada ao sair.
						</span>
					</div>
					<Button
						size="sm"
						disabled={installing}
						onClick={() => void restart()}
					>
						{installing ? "Reiniciando..." : "Reiniciar"}
					</Button>
				</>
			) : (
				<>
					<span className="text-danger">
						Falha na atualização: {notice.message}
					</span>
					<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
						Fechar
					</Button>
				</>
			)}
		</div>
	);
}

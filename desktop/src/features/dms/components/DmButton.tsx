import { MessageCircleIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useOpenDm } from "../queries";

/**
 * O botão "Mensagem" do cartão de uma pessoa (ADR 0020): abre a janela da conversa com ela,
 * criando a conversa se ainda não existe. `onOpened` é para quem pôs o botão fechar o cartão.
 */
export function DmButton({
	userId,
	onOpened,
}: {
	userId: string;
	onOpened?: () => void;
}) {
	const openDm = useOpenDm();
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-1">
			<Button
				variant="primary"
				disabled={busy}
				className="w-full"
				onClick={() => {
					setBusy(true);
					setFailure(null);
					openDm(userId)
						.then(() => onOpened?.())
						.catch((error: unknown) =>
							setFailure(
								error instanceof ApiError
									? error.message
									: "Não foi possível abrir a conversa.",
							),
						)
						.finally(() => setBusy(false));
				}}
			>
				<MessageCircleIcon aria-hidden="true" />
				Mensagem
			</Button>
			{failure && (
				<p role="alert" className="text-xs text-destructive-text">
					{failure}
				</p>
			)}
		</div>
	);
}

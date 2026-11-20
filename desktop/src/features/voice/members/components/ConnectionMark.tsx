import { SignalLowIcon, SignalZeroIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionTrouble } from "../model/members";

/** O ícone de sinal de quem está com a conexão ruim (quadro "Voz — qualidade da conexão"). */
export function ConnectionMark({
	connection,
	className,
}: {
	connection: ConnectionTrouble | undefined;
	className?: string;
}) {
	if (!connection) return null;
	const unstable = connection === "unstable";
	const Icon = unstable ? SignalLowIcon : SignalZeroIcon;
	return (
		<Icon
			role="img"
			aria-label={unstable ? "conexão instável" : "conexão ruim"}
			className={cn(
				"shrink-0",
				unstable ? "text-status-connecting" : "text-destructive-border",
				className,
			)}
		/>
	);
}

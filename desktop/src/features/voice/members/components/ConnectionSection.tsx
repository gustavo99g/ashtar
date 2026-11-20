import { connectionLabel } from "../../room/model/voiceStats";
import { useVoiceStats } from "../../room/stores/voiceStatsStore";
import type { ConnectionTrouble } from "../model/members";

/**
 * A seção Conexão do cartão de quem está na sala (decisão 15): o ping, a perda e o texto. Os números
 * vêm da própria pessoa, a cada 5 segundos; sem eles (o app antigo), só o texto da qualidade que o
 * LiveKit dá, quando está ruim.
 */
export function ConnectionSection({
	userId,
	connection,
}: {
	userId: string;
	connection: ConnectionTrouble | undefined;
}) {
	const stats = useVoiceStats((state) => state.byId[userId]);
	if (!stats && !connection) return null;
	const label =
		connection === "bad"
			? "Ruim"
			: connection === "unstable"
				? "Instável"
				: stats
					? connectionLabel(stats)
					: "Boa";
	const tone =
		label === "Ruim"
			? "text-destructive-text"
			: label === "Instável"
				? "text-warning-text"
				: "text-success-text";
	return (
		<section aria-label="Conexão" className="flex flex-col gap-1.5">
			<span className="flex justify-between text-xs text-muted-foreground">
				<span>Conexão</span>
				<span className={tone}>{label}</span>
			</span>
			{stats && (
				<dl className="grid grid-cols-2 gap-2 text-xs">
					<div className="flex flex-col gap-0.5 rounded-md bg-secondary px-2.5 py-1.5">
						<dt className="text-muted-foreground">Ping</dt>
						<dd className="font-mono text-foreground">
							{stats.ping === null ? "—" : `${stats.ping} ms`}
						</dd>
					</div>
					<div className="flex flex-col gap-0.5 rounded-md bg-secondary px-2.5 py-1.5">
						<dt className="text-muted-foreground">Perda</dt>
						<dd className="font-mono text-foreground">
							{stats.loss === null ? "—" : `${stats.loss}%`}
						</dd>
					</div>
				</dl>
			)}
		</section>
	);
}

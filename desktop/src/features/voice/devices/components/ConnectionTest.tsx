import { ActivityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useConnectionTest } from "../hooks/useConnectionTest";
import type { ConnectionTestResult } from "../model/connectionTest";

/**
 * Testar conexão, em Voz e vídeo (quadro "Configurações — testar conexão", decisão 20): o ping até o
 * servidor de voz, o caminho da voz e se o som sai. Leva uns segundos fora de uma sala.
 */
export function ConnectionTest() {
	const { state, start, inRoom } = useConnectionTest();
	const running = state.status === "running";
	return (
		<div className="flex max-w-[560px] flex-col gap-3">
			<div className="flex items-center gap-3">
				<Button
					variant="secondary"
					onClick={() => void start()}
					disabled={running}
				>
					<ActivityIcon aria-hidden="true" />
					{running ? "Testando…" : "Testar conexão"}
				</Button>
				<span className="text-xs text-muted-foreground">
					{inRoom
						? "Lê a conexão da sala em que você está."
						: "Leva uns 5 segundos. Ninguém vê você entrar."}
				</span>
			</div>
			{state.status === "done" && <Result result={state.result} />}
			{state.status === "failed" && (
				<p role="alert" className="text-[13px] text-destructive-text">
					{state.message}
				</p>
			)}
		</div>
	);
}

function Result({ result }: { result: ConnectionTestResult }) {
	const slowPing = result.ping !== null && result.ping > 150;
	return (
		<dl
			aria-label="Resultado do teste"
			className="grid grid-cols-3 gap-2 text-[13px]"
		>
			<Row
				label="Ping"
				value={result.ping === null ? "—" : `${result.ping} ms`}
				bad={slowPing}
			/>
			<Row
				label="Caminho"
				value={
					result.route === null
						? "—"
						: result.route === "direct"
							? "Direto (UDP)"
							: "Reserva (TCP, mais lento)"
				}
				bad={result.route === "fallback"}
			/>
			<Row
				label="Enviar voz"
				value={result.sending ? "Funciona" : "Não saiu som"}
				bad={!result.sending}
			/>
		</dl>
	);
}

function Row({
	label,
	value,
	bad,
}: {
	label: string;
	value: string;
	bad: boolean;
}) {
	return (
		<div className="flex flex-col gap-0.5 rounded-lg bg-secondary px-3 py-2">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd
				className={cn(
					"font-semibold",
					bad ? "text-warning-text" : "text-foreground",
				)}
			>
				{value}
			</dd>
		</div>
	);
}

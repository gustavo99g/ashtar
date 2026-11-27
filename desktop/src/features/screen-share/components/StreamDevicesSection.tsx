/**
 * Os aparelhos de transmissão (ADR 0038), nas Configurações › Voz e vídeo: um portátil, como o
 * Odin 3, que transmite a tela para a sala ou a ligação em que você está. Aqui você gera o código
 * que o aparelho pede na primeira vez e desvincula os que não usa mais.
 *
 * Só aparece para quem tem "Transmitir de um aparelho" (`can_stream_from_device`); quem decide de
 * verdade é a API.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GamepadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	createStreamPairCode,
	isApiError,
	listStreamDevices,
	type PairCodeResponse,
	type StreamDevice,
	unlinkStreamDevice,
} from "@/lib/api";
import { shortDate } from "@/lib/date";

const devicesKey = ["stream-devices"] as const;

/** "9:41": quanto falta para o código vencer. */
export function remaining(expiresAt: number, now: number): string {
	const left = Math.max(0, expiresAt - Math.floor(now / 1000));
	const minutes = Math.floor(left / 60);
	const seconds = String(left % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}

export function StreamDevicesSection() {
	const client = useQueryClient();
	const devices = useQuery({
		queryKey: devicesKey,
		queryFn: listStreamDevices,
	});
	const [code, setCode] = useState<PairCodeResponse | null>(null);
	// Quantos aparelhos havia quando o código saiu: um a mais quer dizer que ele foi usado.
	const [baseline, setBaseline] = useState(0);
	const count = devices.data?.length ?? 0;
	const pair = useMutation({
		mutationFn: createStreamPairCode,
		onSuccess: (next) => {
			setBaseline(count);
			setCode(next);
		},
	});
	const unlink = useMutation({
		mutationFn: (id: string) => unlinkStreamDevice(id),
		onSuccess: () => client.invalidateQueries({ queryKey: devicesKey }),
	});

	// Enquanto o código está na tela, a lista se atualiza: o aparelho novo aparece sozinho.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!code) return;
		const timer = setInterval(() => {
			setNow(Date.now());
			void client.invalidateQueries({ queryKey: devicesKey });
		}, 3000);
		return () => clearInterval(timer);
	}, [code, client]);
	const expired = code !== null && code.expires_at * 1000 <= now;

	// O código usado some: o aparelho que acabou de entrar está na lista.
	useEffect(() => {
		if (code && count > baseline) setCode(null);
	}, [code, count, baseline]);

	const error = pair.error ?? unlink.error;
	return (
		<div className="flex max-w-[560px] flex-col gap-3">
			<p className="text-[13px] text-muted-foreground">
				Um portátil, como o Odin 3, transmite a tela dele para a sala ou a
				ligação em que você estiver. Abra o app Ashtar Transmissor no aparelho
				e digite o código.
			</p>
			{devices.data && devices.data.length > 0 && (
				<ul aria-label="Aparelhos pareados" className="flex flex-col gap-2">
					{devices.data.map((device) => (
						<DeviceRow
							key={device.id}
							device={device}
							busy={unlink.isPending && unlink.variables === device.id}
							onUnlink={() => unlink.mutate(device.id)}
						/>
					))}
				</ul>
			)}
			{code && !expired ? (
				<div
					aria-label="Código de pareamento"
					className="flex items-center gap-4 rounded-lg border border-border-strong bg-card px-4 py-3"
				>
					<span className="font-mono text-xl font-semibold tracking-[0.12em] text-foreground">
						{code.code}
					</span>
					<span className="text-xs text-muted-foreground">
						Vale por {remaining(code.expires_at, now)}
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto"
						onClick={() => setCode(null)}
					>
						Fechar
					</Button>
				</div>
			) : (
				<div>
					<Button
						variant="outline"
						size="sm"
						disabled={pair.isPending}
						onClick={() => pair.mutate()}
					>
						<GamepadIcon aria-hidden="true" />
						{expired ? "Gerar outro código" : "Parear um aparelho"}
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{isApiError(error)
						? error.message
						: "Não deu certo. Tente de novo em instantes."}
				</p>
			)}
		</div>
	);
}

function DeviceRow({
	device,
	busy,
	onUnlink,
}: {
	device: StreamDevice;
	busy: boolean;
	onUnlink: () => void;
}) {
	return (
		<li className="flex items-center gap-3 rounded-lg bg-card px-3 py-2">
			<GamepadIcon aria-hidden="true" className="size-4 text-muted-foreground" />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[13px] font-semibold text-foreground">
					{device.name}
				</span>
				<span className="text-xs text-muted-foreground">
					Pareado em {shortDate(device.paired_at)} · usado em{" "}
					{shortDate(device.last_seen_at)}
				</span>
			</div>
			<Button
				variant="ghost"
				size="sm"
				disabled={busy}
				aria-label={`Desvincular ${device.name}`}
				onClick={onUnlink}
			>
				Desvincular
			</Button>
		</li>
	);
}

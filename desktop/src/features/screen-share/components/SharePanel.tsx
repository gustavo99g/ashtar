/**
 * O painel completo da própria transmissão. Abre pelo "Detalhes" do popover do botão Tela, pelo
 * "Ajustes" do lugar da transmissão na Grade e pela bandeja. O foco são os números: um aviso de
 * saúde no topo, os números do último segundo em cartões (mais o ping), o envio do último minuto
 * com o limite tracejado e quem está assistindo, há quanto tempo. Os ajustes ficam embaixo, os
 * mesmos do popover (`ShareControls`), e cada um vai direto para o Rust: quem assiste não sai da
 * tela. A imagem que está indo é a miniatura ao vivo da fonte (ADR 0019).
 *
 * Um ajuste que falha (um áudio que não abriu, por exemplo) aparece aqui e a transmissão segue
 * como estava.
 */
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import type { Quality, ShareStats } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { useNow } from "../hooks/useNow";
import { useScreenShareState } from "../hooks/useScreenShareState";
import { useShareControls } from "../hooks/useShareControls";
import { useShareStatsHistory } from "../hooks/useShareStatsHistory";
import { sourceRefKey, useThumbnails } from "../hooks/useThumbnails";
import type {
	ScreenShareController,
	ScreenShareState,
} from "../model/controller";
import {
	formatElapsed,
	HISTORY_SECONDS,
	type ShareHealth,
	shareHealth,
	watchingFor,
} from "../model/health";
import { networkLimited, QUALITY_PRESETS } from "../model/presets";
import { openSourcePicker } from "../stores/pickerStore";
import { useShareViewerList } from "../stores/viewersStore";
import { ControlLabel, ShareControls } from "./ShareControls";
import { mbps } from "./ShareQuickSettings";

type ActiveState = Extract<ScreenShareState, { status: "active" }>;

interface SharePanelProps {
	controller: ScreenShareController;
	open: boolean;
	onClose: () => void;
	/** O ping até o servidor (`usePing` da voz), medido só com o painel aberto. */
	ping: number | null;
}

export function SharePanel({
	controller,
	open,
	onClose,
	ping,
}: SharePanelProps) {
	const state = useScreenShareState(controller);
	const active = state.status === "active";
	return (
		<Dialog
			open={open && active}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="flex max-h-[calc(100%-2rem)] flex-col gap-5 overflow-y-auto rounded-[14px] border-border p-6 sm:max-w-[720px]">
				{active && (
					<PanelBody
						controller={controller}
						state={state}
						ping={ping}
						onClose={onClose}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function PanelBody({
	controller,
	state,
	ping,
	onClose,
}: {
	controller: ScreenShareController;
	state: ActiveState;
	ping: number | null;
	onClose: () => void;
}) {
	const controls = useShareControls(controller, state);
	const history = useShareStatsHistory(controller);
	const stats = history[history.length - 1] ?? null;
	const viewers = useShareViewerList((s) => s.viewers);
	const now = useNow();
	const preview = useThumbnails([state.source.source]).get(
		sourceRefKey(state.source.source),
	);
	const health = shareHealth(history, state.quality);

	return (
		<>
			<header className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-1">
					<DialogTitle className="text-xl font-bold">
						Sua transmissão
					</DialogTitle>
					<DialogDescription className="truncate text-[13px] leading-normal">
						{state.source.source.kind === "window" ? "Janela" : "Tela"}:{" "}
						<span className="font-semibold text-foreground">
							{state.source.title}
						</span>
						{" · no ar há "}
						<span className="font-mono">
							{formatElapsed(state.startedAt, now)}
						</span>
					</DialogDescription>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						className="h-9 text-sm font-medium"
						onClick={() => {
							onClose();
							openSourcePicker("change");
						}}
					>
						Trocar fonte
					</Button>
					<DialogClose
						render={
							<Button
								variant="ghost"
								size="icon"
								className="text-muted-foreground"
							/>
						}
						aria-label="Fechar"
					>
						<XIcon className="size-[18px]" />
					</DialogClose>
				</div>
			</header>

			<HealthBanner health={stats ? health : null} />

			<div className="grid grid-cols-[1fr_220px] gap-4">
				<div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
					{preview ? (
						<img
							src={preview}
							alt="O que está indo agora"
							className="size-full object-contain"
						/>
					) : (
						<span className="text-xs text-muted-foreground">
							Sem imagem por enquanto.
						</span>
					)}
					{state.paused && (
						<span className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm font-semibold text-foreground">
							Pausada: nada está indo para quem assiste
						</span>
					)}
				</div>
				<section
					aria-label="Quem está assistindo"
					className="flex flex-col gap-2"
				>
					<ControlLabel>
						{viewers.length === 0
							? "Ninguém assistindo"
							: `${viewers.length} assistindo`}
					</ControlLabel>
					<ul className="flex flex-col gap-1.5">
						{viewers.map((viewer) => (
							<li
								key={viewer.id}
								className="flex items-baseline justify-between gap-2 text-[13px]"
							>
								<span className="truncate text-foreground">{viewer.name}</span>
								<span className="shrink-0 text-xs text-muted-foreground">
									{watchingFor(viewer.since, now)}
								</span>
							</li>
						))}
					</ul>
				</section>
			</div>

			{stats ? (
				<>
					<StatCards stats={stats} quality={state.quality} ping={ping} />
					<SendChart history={history} />
				</>
			) : (
				<span className="text-xs text-muted-foreground">
					Os números chegam em um segundo.
				</span>
			)}

			<div className="border-t border-border pt-4">
				<ShareControls state={state} controls={controls} />
			</div>

			<footer className="flex items-center gap-3 border-t border-border pt-4">
				<span
					role={controls.failure ? "alert" : undefined}
					className="min-w-0 flex-1 truncate text-[13px] text-destructive"
				>
					{controls.failure && `Não deu para ajustar: ${controls.failure}`}
				</span>
				<Button
					variant="secondary"
					className="h-10 text-sm"
					disabled={controls.busy}
					onClick={() =>
						void controls.apply({ kind: "paused", paused: !state.paused })
					}
				>
					{state.paused ? <PlayIcon /> : <PauseIcon />}
					{state.paused ? "Continuar" : "Pausar"}
				</Button>
				<Button
					variant="danger"
					className="h-10 px-[18px] text-sm"
					onClick={() => {
						onClose();
						void controller.stop();
					}}
				>
					Parar
				</Button>
			</footer>
		</>
	);
}

const HEALTH_TEXT: Record<ShareHealth, string> = {
	ok: "Tudo certo: a imagem está indo no máximo do preset.",
	network:
		"A sua conexão está segurando a transmissão: a imagem perde nitidez até ela melhorar.",
	computer:
		"O computador está no limite: quadros estão ficando para trás. O Leve ou fechar o que estiver pesando ajuda.",
	paused: "Pausada: nada está indo para quem assiste.",
};

function HealthBanner({ health }: { health: ShareHealth | null }) {
	if (!health) return null;
	const warn = health === "network" || health === "computer";
	return (
		<p
			role={warn ? "status" : undefined}
			className={cn(
				"rounded-lg border px-3 py-2 text-[13px] leading-normal",
				warn
					? "border-warning/40 bg-warning-subtle text-warning-text"
					: "border-border bg-rail text-muted-foreground",
			)}
		>
			{HEALTH_TEXT[health]}
		</p>
	);
}

function StatCards({
	stats,
	quality,
	ping,
}: {
	stats: ShareStats;
	quality: Quality;
	ping: number | null;
}) {
	const limited = !stats.paused && networkLimited(quality, stats.targetKbps);
	return (
		<dl className="grid grid-cols-3 gap-2">
			<Card
				label="Imagem"
				detail={`${stats.fps} de ${QUALITY_PRESETS[quality].fps} fps`}
			>
				{stats.width}×{stats.height}
			</Card>
			<Card
				label="Envio"
				detail={
					<span className={cn(limited && "font-semibold text-warning-text")}>
						limite {mbps(stats.targetKbps)}
					</span>
				}
			>
				{mbps(stats.bitrateKbps)} Mbps
			</Card>
			<Card label="Atraso" detail="da captura ao envio">
				{stats.latencyMs} ms
			</Card>
			<Card label="Perdidos" detail="quadros nesta transmissão">
				{stats.dropped}
			</Card>
			<Card
				label="Encoder"
				detail={
					stats.encoder.kind === "hardware"
						? stats.adapter
						: "sem encoder de hardware"
				}
			>
				{stats.encoder.kind === "hardware" ? stats.encoder.name : "Software"}
			</Card>
			<Card label="Ping" detail="até o servidor">
				{ping == null ? "—" : `${ping} ms`}
			</Card>
		</dl>
	);
}

function Card({
	label,
	detail,
	children,
}: {
	label: string;
	detail: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-rail px-3 py-2">
			<dt className="text-[11px] text-muted-foreground">{label}</dt>
			<dd className="truncate font-mono text-sm text-foreground">{children}</dd>
			<dd className="truncate text-[11px] text-muted-foreground">{detail}</dd>
		</div>
	);
}

/** O envio do último minuto (a linha) e o limite que a LiveKit pediu (tracejado). */
function SendChart({ history }: { history: readonly ShareStats[] }) {
	const top =
		Math.max(...history.map((s) => Math.max(s.bitrateKbps, s.targetKbps)), 1) *
		1.15;
	const x = (i: number) =>
		((HISTORY_SECONDS - history.length + i) / (HISTORY_SECONDS - 1)) * 100;
	const y = (kbps: number) => 100 - (kbps / top) * 100;
	const line = (pick: (s: ShareStats) => number) =>
		history
			.map((s, i) => `${x(i).toFixed(2)},${y(pick(s)).toFixed(2)}`)
			.join(" ");
	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between">
				<ControlLabel>Envio no último minuto</ControlLabel>
				<span className="text-[11px] text-muted-foreground">
					tracejado = limite
				</span>
			</div>
			<svg
				role="img"
				aria-label={`Envio no último minuto: agora ${mbps(history[history.length - 1].bitrateKbps)} Mbps`}
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				className="h-24 w-full rounded-lg border border-border bg-rail"
			>
				<polyline
					points={line((s) => s.targetKbps)}
					fill="none"
					className="stroke-muted-foreground"
					strokeWidth="1.5"
					strokeDasharray="4 3"
					vectorEffect="non-scaling-stroke"
				/>
				<polyline
					points={line((s) => s.bitrateKbps)}
					fill="none"
					className="stroke-primary"
					strokeWidth="2"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
		</section>
	);
}

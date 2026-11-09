/**
 * Os ajustes rápidos da própria transmissão, no popover do botão Tela enquanto ela está no ar: a
 * fonte, o tempo no ar, quantos assistem, a qualidade, o áudio, o cursor, uma linha com os números,
 * pausar e parar. "Detalhes" abre o painel completo (`SharePanel`).
 */
import { PauseIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ShareStats } from "@/lib/tauri/commands";
import { useNow } from "../hooks/useNow";
import { useScreenShareState } from "../hooks/useScreenShareState";
import { useShareControls } from "../hooks/useShareControls";
import { useShareStats } from "../hooks/useShareStats";
import type {
	ScreenShareController,
	ScreenShareState,
} from "../model/controller";
import { formatElapsed } from "../model/health";
import { openSharePanel, openSourcePicker } from "../stores/pickerStore";
import { useShareViewerList } from "../stores/viewersStore";
import { ShareControls } from "./ShareControls";

type ActiveState = Extract<ScreenShareState, { status: "active" }>;

export function ShareQuickSettings({
	controller,
	onClose,
}: {
	controller: ScreenShareController;
	/** Fecha o popover: antes de abrir o seletor ou o painel, e ao parar. */
	onClose: () => void;
}) {
	const state = useScreenShareState(controller);
	if (state.status !== "active") return null;
	return <QuickBody controller={controller} state={state} onClose={onClose} />;
}

function QuickBody({
	controller,
	state,
	onClose,
}: {
	controller: ScreenShareController;
	state: ActiveState;
	onClose: () => void;
}) {
	const controls = useShareControls(controller, state);
	const stats = useShareStats(controller);
	const viewers = useShareViewerList((s) => s.viewers);
	const now = useNow();

	return (
		<div className="flex flex-col gap-3.5">
			<header className="flex items-start gap-3">
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate text-sm font-semibold text-foreground">
						{state.source.source.kind === "window" ? "Janela" : "Tela"}:{" "}
						{state.source.title}
					</span>
					<span className="text-xs text-muted-foreground">
						<span className="font-mono">
							{formatElapsed(state.startedAt, now)}
						</span>
						{" · "}
						{viewers.length === 0
							? "ninguém assistindo"
							: `${viewers.length} assistindo`}
					</span>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						onClose();
						openSourcePicker("change");
					}}
				>
					Trocar
				</Button>
			</header>

			<ShareControls state={state} controls={controls} compact />

			<StatsLine stats={stats} paused={state.paused} />

			{controls.failure && (
				<span role="alert" className="text-xs text-destructive">
					Não deu para ajustar: {controls.failure}
				</span>
			)}

			<footer className="flex items-center gap-2 border-t border-border pt-3">
				<Button
					variant="ghost"
					size="sm"
					className="mr-auto"
					onClick={() => {
						onClose();
						openSharePanel();
					}}
				>
					Detalhes
				</Button>
				<Button
					variant="secondary"
					size="sm"
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
					size="sm"
					onClick={() => {
						onClose();
						void controller.stop();
					}}
				>
					Parar
				</Button>
			</footer>
		</div>
	);
}

/** "1080p · 60 fps · 7,5 Mbps · 6 ms", ou o porquê de não haver números. */
function StatsLine({
	stats,
	paused,
}: {
	stats: ShareStats | null;
	paused: boolean;
}) {
	const text = paused
		? "Pausada: nada está indo para quem assiste."
		: stats
			? `${stats.height}p · ${stats.fps} fps · ${mbps(stats.bitrateKbps)} Mbps · ${stats.latencyMs} ms`
			: "Os números chegam em um segundo.";
	return (
		<span className="font-mono text-xs text-muted-foreground">{text}</span>
	);
}

export function mbps(kbps: number): string {
	return (kbps / 1000).toFixed(1).replace(".", ",");
}

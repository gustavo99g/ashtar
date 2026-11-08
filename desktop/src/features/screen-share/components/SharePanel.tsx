/**
 * O painel da própria transmissão: a imagem que está indo (a miniatura ao vivo, ADR 0019), os
 * números do último segundo, quem está assistindo e os ajustes no meio (qualidade, fonte, áudio,
 * cursor, pausa e parar). Cada ajuste vai direto para o Rust; quem assiste não sai da tela.
 *
 * Um ajuste que falha (um áudio que não abriu, por exemplo) aparece aqui e a transmissão segue
 * como estava.
 */
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { AudioMode, Quality, ShareStats } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { useScreenShareState } from "../hooks/useScreenShareState";
import { useShareStats } from "../hooks/useShareStats";
import { sourceRefKey, useThumbnails } from "../hooks/useThumbnails";
import type {
	ScreenShareController,
	ScreenShareState,
	ShareChange,
} from "../model/controller";
import {
	networkLimited,
	QUALITY_ORDER,
	QUALITY_PRESETS,
} from "../model/presets";
import { openSourcePicker } from "../stores/pickerStore";

type ActiveState = Extract<ScreenShareState, { status: "active" }>;
type AudioChoice = AudioMode["mode"];

interface SharePanelProps {
	controller: ScreenShareController;
	open: boolean;
	onClose: () => void;
	/** Os nomes de quem está assistindo agora. */
	viewers: readonly string[];
}

export function SharePanel({
	controller,
	open,
	onClose,
	viewers,
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
			<DialogContent className="flex max-h-[calc(100%-2rem)] flex-col gap-5 overflow-y-auto rounded-[14px] border-border p-6 sm:max-w-[640px]">
				{active && (
					<PanelBody
						controller={controller}
						state={state}
						viewers={viewers}
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
	viewers,
	onClose,
}: {
	controller: ScreenShareController;
	state: ActiveState;
	viewers: readonly string[];
	onClose: () => void;
}) {
	const stats = useShareStats(controller);
	const preview = useThumbnails([state.source.source]).get(
		sourceRefKey(state.source.source),
	);
	const [failure, setFailure] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function apply(change: ShareChange) {
		setBusy(true);
		setFailure(null);
		try {
			await controller.update(change);
		} catch (error) {
			setFailure(
				typeof error === "object" && error !== null && "message" in error
					? String(error.message)
					: String(error),
			);
		} finally {
			setBusy(false);
		}
	}

	const processId = state.source.processId;
	const audioChoices: AudioChoice[] =
		state.source.source.kind === "window" && processId != null
			? ["off", "application", "system"]
			: ["off", "system"];
	const audioChoice = state.audioMode.mode;

	function audioMode(choice: AudioChoice): AudioMode {
		if (choice === "application" && processId != null) {
			return { mode: "application", processId };
		}
		return { mode: choice === "application" ? "off" : choice };
	}

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
					</DialogDescription>
				</div>
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
			</header>

			<div className="grid grid-cols-[1fr_200px] gap-4">
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
				<StatsList stats={stats} quality={state.quality} />
			</div>

			<section className="flex flex-col gap-1.5">
				<Label>
					{viewers.length === 0
						? "Ninguém assistindo"
						: `${viewers.length} assistindo`}
				</Label>
				{viewers.length > 0 && (
					<span className="text-[13px] text-foreground">
						{viewers.join(", ")}
					</span>
				)}
			</section>

			<div className="grid grid-cols-2 gap-6 border-t border-border pt-4">
				<section className="flex flex-col gap-2.5">
					<Label>Qualidade</Label>
					<Segmented
						aria-label="Qualidade"
						value={state.quality}
						onValueChange={(next) =>
							void apply({ kind: "quality", quality: next as Quality })
						}
					>
						{QUALITY_ORDER.map((value) => (
							<SegmentedItem key={value} value={value}>
								{QUALITY_PRESETS[value].label}
							</SegmentedItem>
						))}
					</Segmented>
					<span className="text-xs leading-normal text-muted-foreground">
						{QUALITY_PRESETS[state.quality].description}
					</span>
					<label className="mt-2 flex cursor-pointer items-center gap-2.5">
						<Switch
							variant="blue"
							checked={state.cursor}
							disabled={busy}
							onCheckedChange={(enabled) =>
								void apply({ kind: "cursor", enabled })
							}
						/>
						<span className="text-sm text-foreground">Mostrar o cursor</span>
					</label>
				</section>

				<section className="flex flex-col gap-2.5">
					<Label>Áudio</Label>
					<Segmented
						aria-label="Áudio"
						value={audioChoice}
						onValueChange={(next) =>
							void apply({
								kind: "audio",
								audio: audioMode(next as AudioChoice),
							})
						}
					>
						{audioChoices.map((choice) => (
							<SegmentedItem key={choice} value={choice}>
								{AUDIO_LABELS[choice]}
							</SegmentedItem>
						))}
					</Segmented>
					{state.audio === "lost" && (
						<span className="text-xs leading-normal text-warning-text">
							O áudio caiu. Escolha de novo para religar.
						</span>
					)}
				</section>
			</div>

			<footer className="flex items-center gap-3 border-t border-border pt-4">
				<span
					role={failure ? "alert" : undefined}
					className="min-w-0 flex-1 truncate text-[13px] text-destructive"
				>
					{failure && `Não deu para ajustar: ${failure}`}
				</span>
				<Button
					variant="ghost"
					className="h-10 text-sm font-medium"
					onClick={() => {
						onClose();
						openSourcePicker("change");
					}}
				>
					Trocar fonte
				</Button>
				<Button
					variant="secondary"
					className="h-10 text-sm"
					disabled={busy}
					onClick={() => void apply({ kind: "paused", paused: !state.paused })}
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

const AUDIO_LABELS: Record<AudioChoice, string> = {
	off: "Sem áudio",
	application: "Do aplicativo",
	system: "Do sistema",
};

function StatsList({
	stats,
	quality,
}: {
	stats: ShareStats | null;
	quality: Quality;
}) {
	if (!stats) {
		return (
			<span className="text-xs text-muted-foreground">
				Os números chegam em um segundo.
			</span>
		);
	}
	const limited = !stats.paused && networkLimited(quality, stats.targetKbps);
	return (
		<dl className="grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1 text-xs">
			<Stat label="Imagem">
				{stats.width} × {stats.height}, {stats.fps} fps
			</Stat>
			<Stat label="Envio">{(stats.bitrateKbps / 1000).toFixed(1)} Mbps</Stat>
			<Stat label="Limite">
				<span className={cn(limited && "font-semibold text-warning-text")}>
					{(stats.targetKbps / 1000).toFixed(1)} Mbps
				</span>
			</Stat>
			<Stat label="Encoder">
				{stats.encoder.kind === "hardware" ? stats.encoder.name : "Software"}
			</Stat>
			<Stat label="Atraso">{stats.latencyMs} ms</Stat>
			<Stat label="Perdidos">{stats.dropped}</Stat>
			{limited && (
				<dd className="col-span-2 mt-1 leading-normal text-warning-text">
					A sua conexão está segurando a transmissão: a imagem perde nitidez até
					ela melhorar.
				</dd>
			)}
		</dl>
	);
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-mono text-foreground">{children}</dd>
		</>
	);
}

function Label({ children }: { children: ReactNode }) {
	return (
		<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
			{children}
		</span>
	);
}

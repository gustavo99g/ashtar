/**
 * Qualidade, áudio e cursor da transmissão no ar: os mesmos no popover do botão e no painel
 * completo. `compact` encurta os rótulos do áudio e tira a descrição do preset, para caber no
 * popover.
 */
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { Quality } from "@/lib/tauri/commands";
import type { AudioChoice, useShareControls } from "../hooks/useShareControls";
import type { ScreenShareState } from "../model/controller";
import { QUALITY_ORDER, QUALITY_PRESETS } from "../model/presets";

type ActiveState = Extract<ScreenShareState, { status: "active" }>;

const AUDIO_LABELS: Record<AudioChoice, string> = {
	off: "Sem áudio",
	application: "Do aplicativo",
	system: "Do sistema",
};

const AUDIO_SHORT: Record<AudioChoice, string> = {
	off: "Sem áudio",
	application: "Aplicativo",
	system: "Sistema",
};

export function ShareControls({
	state,
	controls,
	compact = false,
}: {
	state: ActiveState;
	controls: ReturnType<typeof useShareControls>;
	compact?: boolean;
}) {
	const { apply, busy, audioChoices, audioMode } = controls;
	const labels = compact ? AUDIO_SHORT : AUDIO_LABELS;
	return (
		<div className={compact ? "flex flex-col gap-3" : "grid grid-cols-2 gap-6"}>
			<section className="flex flex-col gap-2">
				<ControlLabel>Qualidade</ControlLabel>
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
				{!compact && (
					<span className="text-xs leading-normal text-muted-foreground">
						{QUALITY_PRESETS[state.quality].description}
					</span>
				)}
				{!compact && <CursorSwitch state={state} controls={controls} />}
			</section>
			<section className="flex flex-col gap-2">
				<ControlLabel>Áudio</ControlLabel>
				<Segmented
					aria-label="Áudio"
					value={state.audioMode.mode}
					onValueChange={(next) =>
						void apply({
							kind: "audio",
							audio: audioMode(next as AudioChoice),
						})
					}
				>
					{audioChoices.map((choice) => (
						<SegmentedItem key={choice} value={choice}>
							{labels[choice]}
						</SegmentedItem>
					))}
				</Segmented>
				{state.audio === "lost" && (
					<span className="text-xs leading-normal text-warning-text">
						O áudio caiu. Escolha de novo para religar.
					</span>
				)}
			</section>
			{compact && <CursorSwitch state={state} controls={controls} />}
			{busy && <span className="sr-only">Ajustando…</span>}
		</div>
	);
}

function CursorSwitch({
	state,
	controls,
}: {
	state: ActiveState;
	controls: ReturnType<typeof useShareControls>;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2.5">
			<Switch
				variant="blue"
				checked={state.cursor}
				disabled={controls.busy}
				onCheckedChange={(enabled) =>
					void controls.apply({ kind: "cursor", enabled })
				}
			/>
			<span className="text-sm text-foreground">Mostrar o cursor</span>
		</label>
	);
}

export function ControlLabel({ children }: { children: string }) {
	return (
		<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
			{children}
		</span>
	);
}

import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { LoadingState } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	clampClip,
	decodeSound,
	MAX_CLIP_S,
	MAX_GAIN_DB,
	MIN_GAIN_DB,
	peaks,
	renderClip,
	SAMPLE_RATE,
	seconds,
} from "../model/audio";
import { playSamples } from "../model/player";
import { useCreateSound } from "../queries";
import { Waveform } from "./Waveform";

/*
 * O "Novo som" (quadro "Sons — Meus sons", decisão 22): a onda do arquivo com as duas alças
 * douradas para escolher até 5 s, o play só do trecho, o volume (-12 a +6 dB), "Igualar volume",
 * "Suavizar início" e "Suavizar fim", o emoji e o nome. O que sobe é o trecho já editado, em WAV.
 * Para quem aprova, o som entra direto; para os outros, vai para a fila.
 */

const BARS = 120;
export const NAME_MAX = 24;

export interface EditorSource {
	/** O arquivo carregado, ou o WAV de um som seu (o "Editar e reenviar"). */
	blob: Blob;
	fileName: string;
	name: string;
	emoji: string | null;
	/** O som (aguardando ou recusado) que este substitui. */
	replaces?: string;
}

/** O que impede de enviar com esse nome, ou `null`. */
export function soundNameProblem(name: string): string | null {
	const trimmed = name.trim();
	if (trimmed === "") return "Dê um nome ao som.";
	if ([...trimmed].length > NAME_MAX) return `Até ${NAME_MAX} letras.`;
	return null;
}

function message(error: unknown): string {
	if (error instanceof ApiError || error instanceof Error) return error.message;
	return "Tente de novo.";
}

export function SoundEditor({
	source,
	direct,
	onDone,
}: {
	source: EditorSource;
	/** Quem aprova envia direto, sem fila. */
	direct: boolean;
	onDone: () => void;
}) {
	const [samples, setSamples] = useState<Float32Array | null>(null);
	const [failed, setFailed] = useState(false);
	const [clip, setClip] = useState({ start: 0, end: MAX_CLIP_S });
	const [gainDb, setGainDb] = useState(0);
	const [normalize, setNormalize] = useState(false);
	const [fadeIn, setFadeIn] = useState(false);
	const [fadeOut, setFadeOut] = useState(false);
	const [name, setName] = useState(source.name);
	const [emoji, setEmoji] = useState(source.emoji ?? "");
	const [playing, setPlaying] = useState(false);
	const stop = useRef<(() => void) | null>(null);
	const create = useCreateSound();

	useEffect(() => {
		let alive = true;
		decodeSound(source.blob).then(
			(decoded) => {
				if (!alive) return;
				setSamples(decoded);
				setClip(clampClip(0, MAX_CLIP_S, decoded.length / SAMPLE_RATE));
			},
			() => alive && setFailed(true),
		);
		return () => {
			alive = false;
			stop.current?.();
		};
	}, [source.blob]);

	const duration = samples ? samples.length / SAMPLE_RATE : 0;
	const bars = useMemo(() => (samples ? peaks(samples, BARS) : []), [samples]);
	const options = { ...clip, gainDb, normalize, fadeIn, fadeOut };

	function select(edge: "start" | "end", at: number) {
		const time = at * duration;
		stop.current?.();
		setClip((current) => {
			if (edge === "start") {
				// Puxar o início além dos 5 s arrasta o fim junto.
				const end = Math.max(current.end, time + 0.1);
				return clampClip(time, Math.min(end, time + MAX_CLIP_S), duration);
			}
			const start = Math.min(current.start, time - 0.1);
			return clampClip(Math.max(start, time - MAX_CLIP_S), time, duration);
		});
	}

	function togglePlay() {
		if (!samples) return;
		if (playing) {
			stop.current?.();
			return;
		}
		setPlaying(true);
		stop.current = playSamples(renderClip(samples, options), SAMPLE_RATE, () => {
			setPlaying(false);
			stop.current = null;
		});
	}

	function submit() {
		if (!samples || soundNameProblem(name)) return;
		stop.current?.();
		create.mutate(
			{
				samples: renderClip(samples, options),
				name: name.trim(),
				emoji: emoji.trim() || null,
				replaces: source.replaces,
			},
			{ onSuccess: onDone },
		);
	}

	const nameProblem = name === "" ? null : soundNameProblem(name);
	const length = clip.end - clip.start;

	return (
		<form
			aria-label="Novo som"
			className="flex flex-col gap-4 rounded-xl border border-primary bg-card p-5"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="flex items-center justify-between gap-4">
				<span className="min-w-0 truncate text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
					{source.replaces ? "Editar e reenviar" : "Novo som"} · {source.fileName}
				</span>
				{samples && (
					<span className="shrink-0 font-mono text-xs text-muted-foreground">
						arquivo com {seconds(duration)} ·{" "}
						{Math.round(source.blob.size / 1024)} KB
					</span>
				)}
			</div>

			{failed ? (
				<p role="alert" className="text-[13px] text-destructive-text">
					Não deu para abrir esse arquivo. Tente um MP3, OGG ou WAV.
				</p>
			) : !samples ? (
				<LoadingState className="py-6" />
			) : (
				<>
					<div className="rounded-lg border border-border bg-background px-2">
						<Waveform
							bars={bars}
							selection={{
								start: duration > 0 ? clip.start / duration : 0,
								end: duration > 0 ? clip.end / duration : 1,
							}}
							onSelect={select}
						/>
					</div>
					<div className="flex items-center gap-3">
						<Button
							type="button"
							size="icon"
							className="rounded-full"
							aria-label={playing ? "Parar" : "Ouvir o trecho"}
							onClick={togglePlay}
						>
							{playing ? <PauseIcon /> : <PlayIcon />}
						</Button>
						<span className="font-mono text-xs text-muted-foreground">
							início {seconds(clip.start)} · fim {seconds(clip.end)} · trecho{" "}
							<span className="text-gold">{seconds(length)}</span> de no máximo{" "}
							{MAX_CLIP_S} s
						</span>
					</div>
					<div className="h-px bg-border" />
					<div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-[13px] text-foreground">
						<label className="flex items-center gap-3">
							Volume
							<Slider
								aria-label="Volume do som"
								className="w-36"
								min={MIN_GAIN_DB}
								max={MAX_GAIN_DB}
								step={1}
								value={gainDb}
								onValueChange={(value) => setGainDb(value as number)}
							/>
							<span className="w-12 font-mono text-xs text-muted-foreground">
								{gainDb > 0 ? `+${gainDb}` : gainDb} dB
							</span>
						</label>
						<Toggle label="Igualar volume" checked={normalize} onChange={setNormalize} />
						<Toggle label="Suavizar início" checked={fadeIn} onChange={setFadeIn} />
						<Toggle label="Suavizar fim" checked={fadeOut} onChange={setFadeOut} />
					</div>
				</>
			)}

			<div className="flex items-end gap-3">
				<label className="flex flex-col gap-1.5">
					<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
						Emoji
					</span>
					<Input
						aria-label="Emoji do som"
						value={emoji}
						maxLength={16}
						onChange={(event) => setEmoji(event.target.value)}
						placeholder="🔊"
						className="w-12 text-center text-lg"
					/>
				</label>
				<label className="flex min-w-0 flex-1 flex-col gap-1.5">
					<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
						Nome
					</span>
					<Input
						aria-label="Nome do som"
						aria-invalid={nameProblem !== null || undefined}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<Button type="button" variant="ghost" onClick={onDone}>
					Cancelar
				</Button>
				<Button
					type="submit"
					disabled={!samples || soundNameProblem(name) !== null || create.isPending}
				>
					{create.isPending
						? "Enviando…"
						: direct
							? "Enviar"
							: "Enviar para aprovação"}
				</Button>
			</div>
			{(nameProblem || create.error) && (
				<p role="alert" className="text-[13px] text-destructive-text">
					{nameProblem ?? message(create.error)}
				</p>
			)}
			<p className={cn("text-xs text-muted-foreground")}>
				Arraste as alças douradas para escolher até {MAX_CLIP_S} s. O corte e o volume
				são feitos aqui, antes de enviar.
			</p>
		</form>
	);
}

function Toggle({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2.5">
			<Switch variant="blue" checked={checked} onCheckedChange={onChange} />
			{label}
		</label>
	);
}

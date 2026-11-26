import { SearchIcon, Volume2Icon, XIcon } from "lucide-react";
import { type DragEvent, useState } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
	SLOT_COUNT,
	setSlot,
	SoundEmoji,
	setSoundboardVolume,
	useSoundboard,
	useSounds,
} from "@/features/sounds";
import type { Sound } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * A grade do soundboard (quadro "Soundboard — tocar sons", v0.9, ADR 0037): o volume, a busca, os
 * 4 lugares (cada um com o seu atalho, Ctrl + Alt + 1 a 4) e todos os sons aprovados em 4 colunas.
 * Arrastar um som para um lugar põe ele lá, e o botão direito tem "Pôr no lugar 1–4"; o som que
 * está num lugar ganha o número dourado. Um lugar com um som que foi excluído fica "Som removido".
 */

/** O tipo do arrastar: só os sons da grade caem num lugar. */
const DRAG_TYPE = "application/x-ashtar-sound";

/** Os sons que batem com a busca (nome ou emoji, sem acento e sem caixa). */
export function filterSounds(sounds: Sound[], query: string): Sound[] {
	const key = (text: string) =>
		text
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase();
	const wanted = key(query.trim());
	if (wanted === "") return sounds;
	return sounds.filter(
		(sound) =>
			key(sound.name).includes(wanted) || (sound.emoji ?? "") === query.trim(),
	);
}

export function SoundGrid({ onPlay }: { onPlay: (sound: Sound) => void }) {
	const sounds = useSounds();
	const { slots, volume } = useSoundboard();
	const [query, setQuery] = useState("");
	const shown = filterSounds(sounds, query);
	const byId = new Map(sounds.map((sound) => [sound.id, sound]));

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<span className="flex-1 text-sm font-semibold text-foreground">Sons</span>
				<Volume2Icon aria-hidden="true" className="size-4 text-muted-foreground" />
				<Slider
					aria-label="Volume dos sons"
					className="w-24"
					min={0}
					max={100}
					value={volume}
					onValueChange={(value) => setSoundboardVolume(value as number)}
				/>
			</div>
			<div className="relative">
				<SearchIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					aria-label="Buscar som"
					placeholder="Buscar som"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="h-8 pl-8 text-[13px]"
				/>
			</div>
			<section aria-label="Lugares" className="grid grid-cols-4 gap-1.5">
				{Array.from({ length: SLOT_COUNT }, (_, index) => (
					<Slot
						// biome-ignore lint/suspicious/noArrayIndexKey: os lugares são fixos.
						key={index}
						index={index}
						soundId={slots[index] ?? null}
						sound={byId.get(slots[index] ?? "") ?? null}
						onPlay={onPlay}
					/>
				))}
			</section>
			<div className="h-px bg-border" />
			{sounds.length === 0 ? (
				<p className="py-4 text-center text-[13px] text-muted-foreground">
					Nenhum som no grupo ainda. Envie o primeiro em Configurações ›
					Servidor › Sons.
				</p>
			) : shown.length === 0 ? (
				<p className="py-4 text-center text-[13px] text-muted-foreground">
					Nenhum som com esse nome.
				</p>
			) : (
				<ul
					aria-label="Todos os sons"
					className="grid max-h-[260px] grid-cols-4 gap-1.5 overflow-y-auto"
				>
					{shown.map((sound) => (
						<li key={sound.id}>
							<SoundTile
								sound={sound}
								slot={slots.indexOf(sound.id)}
								onPlay={onPlay}
							/>
						</li>
					))}
				</ul>
			)}
			<p className="text-[11px] text-muted-foreground">
				Arraste um som para um lugar. Ctrl + Alt + 1 a 4 tocam os lugares de
				qualquer janela.
			</p>
		</div>
	);
}

function SoundFace({ sound }: { sound: Sound }) {
	return (
		<>
			<span aria-hidden="true" className="text-lg leading-none">
				<SoundEmoji emoji={sound.emoji} className="size-5" />
			</span>
			<span className="w-full truncate text-[11px] font-medium">{sound.name}</span>
		</>
	);
}

/** O número dourado do lugar, no canto. */
function SlotNumber({ index }: { index: number }) {
	return (
		<span className="absolute top-1 left-1 flex size-4 items-center justify-center rounded-sm bg-gold-subtle text-[10px] font-bold text-gold-text">
			{index + 1}
		</span>
	);
}

function SoundTile({
	sound,
	slot,
	onPlay,
}: {
	sound: Sound;
	/** O lugar em que o som está, ou -1. */
	slot: number;
	onPlay: (sound: Sound) => void;
}) {
	const tile = (
		<button
			type="button"
			draggable
			title={sound.name}
			aria-label={slot >= 0 ? `${sound.name}, lugar ${slot + 1}` : sound.name}
			onDragStart={(event) => {
				event.dataTransfer.setData(DRAG_TYPE, sound.id);
				event.dataTransfer.effectAllowed = "copy";
			}}
			onClick={() => onPlay(sound)}
			className="relative flex h-14 w-full flex-col items-center justify-center gap-1 rounded-lg bg-secondary-hover px-1.5 text-foreground hover:bg-accent"
		>
			{slot >= 0 && <SlotNumber index={slot} />}
			<SoundFace sound={sound} />
		</button>
	);
	return (
		<ContextMenu>
			<ContextMenuTrigger render={tile} />
			<ContextMenuContent aria-label={`Som ${sound.name}`} className="w-[200px]">
				{Array.from({ length: SLOT_COUNT }, (_, index) => (
					<DropdownMenuItem
						// biome-ignore lint/suspicious/noArrayIndexKey: os lugares são fixos.
						key={index}
						disabled={slot === index}
						onClick={() => setSlot(index, sound.id)}
					>
						Pôr no lugar {index + 1}
					</DropdownMenuItem>
				))}
				{slot >= 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => setSlot(slot, null)}>
							Tirar do lugar {slot + 1}
						</DropdownMenuItem>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}

function Slot({
	index,
	soundId,
	sound,
	onPlay,
}: {
	index: number;
	soundId: string | null;
	sound: Sound | null;
	onPlay: (sound: Sound) => void;
}) {
	const [over, setOver] = useState(false);
	const accepts = (event: DragEvent) =>
		event.dataTransfer.types.includes(DRAG_TYPE);
	const dropProps = {
		onDragOver: (event: DragEvent) => {
			if (!accepts(event)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			setOver(true);
		},
		onDragLeave: () => setOver(false),
		onDrop: (event: DragEvent) => {
			setOver(false);
			const id = event.dataTransfer.getData(DRAG_TYPE);
			if (!id) return;
			event.preventDefault();
			setSlot(index, id);
		},
	};
	const frame = cn(
		"relative flex h-14 w-full flex-col items-center justify-center gap-1 rounded-lg px-1.5",
		over && "ring-2 ring-gold",
	);

	if (sound) {
		return (
			<button
				type="button"
				title={sound.name}
				aria-label={`Lugar ${index + 1}: ${sound.name}`}
				onClick={() => onPlay(sound)}
				className={cn(
					frame,
					"bg-gold-subtle text-foreground hover:brightness-110",
				)}
				{...dropProps}
			>
				<SlotNumber index={index} />
				<SoundFace sound={sound} />
			</button>
		);
	}
	return (
		<div
			role="group"
			aria-label={
				soundId ? `Lugar ${index + 1}: som removido` : `Lugar ${index + 1}: vazio`
			}
			className={cn(
				frame,
				"border border-dashed border-border-strong text-muted-foreground",
			)}
			{...dropProps}
		>
			<SlotNumber index={index} />
			{soundId ? (
				<>
					<span className="px-3 pt-2 text-center text-[10px] leading-tight italic">
						Som removido
					</span>
					<button
						type="button"
						aria-label={`Esvaziar o lugar ${index + 1}`}
						onClick={() => setSlot(index, null)}
						className="absolute top-1 right-1 rounded-sm p-0.5 hover:bg-secondary hover:text-foreground"
					>
						<XIcon className="size-3" />
					</button>
				</>
			) : (
				<span className="px-3 pt-2 text-center text-[10px] leading-tight">
					Arraste um som
				</span>
			)}
		</div>
	);
}

/**
 * O recorte da foto nova (o quadro "Perfil — recortar foto"): a imagem num círculo, com o zoom no
 * controle de baixo (ou na roda do mouse) e arrastada com o mouse ou com as setas. O Aplicar
 * desenha o que está no círculo num quadrado de 256 pixels, em WebP, e envia.
 */
import { MinusIcon, PlusIcon } from "lucide-react";
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useRef,
	useState,
	type WheelEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { ApiError } from "@/lib/api";
import {
	AVATAR_OUTPUT,
	type CropState,
	clampCrop,
	cropScale,
	cropSource,
	ZOOM_MAX,
	ZOOM_MIN,
} from "../model/avatarCrop";

/** O lado do círculo na tela, em pixels. */
const VIEW = 240;
const START: CropState = { zoom: 1, x: 0, y: 0 };

type Loaded =
	| { status: "loading" }
	| { status: "ready"; image: HTMLImageElement; url: string }
	| { status: "failed" };

function useImage(file: File | null): Loaded {
	const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
	useEffect(() => {
		if (!file) return;
		setLoaded({ status: "loading" });
		const url = URL.createObjectURL(file);
		const image = new Image();
		let alive = true;
		image.onload = () => alive && setLoaded({ status: "ready", image, url });
		image.onerror = () => alive && setLoaded({ status: "failed" });
		image.src = url;
		return () => {
			alive = false;
			URL.revokeObjectURL(url);
		};
	}, [file]);
	return loaded;
}

/** O que está no círculo, como um quadrado de 256 pixels (WebP; PNG onde não houver WebP). */
function render(image: HTMLImageElement, crop: CropState): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = AVATAR_OUTPUT;
	canvas.height = AVATAR_OUTPUT;
	const context = canvas.getContext("2d");
	if (!context) return Promise.reject(new Error("canvas"));
	const { sx, sy, size } = cropSource(
		image.naturalWidth,
		image.naturalHeight,
		VIEW,
		crop,
	);
	context.imageSmoothingQuality = "high";
	context.drawImage(image, sx, sy, size, size, 0, 0, AVATAR_OUTPUT, AVATAR_OUTPUT);
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("canvas"))),
			"image/webp",
			0.9,
		),
	);
}

export function AvatarCropDialog({
	file,
	onApply,
	onClose,
}: {
	/** A imagem escolhida; `null` fecha. Quem usa troca a `key` a cada imagem, para recomeçar. */
	file: File | null;
	onApply: (image: Blob) => Promise<unknown>;
	onClose: () => void;
}) {
	const loaded = useImage(file);
	const [crop, setCrop] = useState<CropState>(START);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const drag = useRef<{ x: number; y: number; from: CropState } | null>(null);

	const ready = loaded.status === "ready" ? loaded : null;
	const width = ready?.image.naturalWidth ?? 1;
	const height = ready?.image.naturalHeight ?? 1;

	function change(next: CropState) {
		setCrop(clampCrop(width, height, VIEW, next));
	}

	function onPointerDown(event: PointerEvent<HTMLDivElement>) {
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { x: event.clientX, y: event.clientY, from: crop };
	}

	function onPointerMove(event: PointerEvent<HTMLDivElement>) {
		const start = drag.current;
		if (!start) return;
		change({
			...start.from,
			x: start.from.x + event.clientX - start.x,
			y: start.from.y + event.clientY - start.y,
		});
	}

	function onWheel(event: WheelEvent<HTMLDivElement>) {
		change({ ...crop, zoom: crop.zoom - event.deltaY / 500 });
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const step = event.shiftKey ? 40 : 10;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [step, 0],
			ArrowRight: [-step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step],
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		change({ ...crop, x: crop.x + move[0], y: crop.y + move[1] });
	}

	async function apply() {
		if (!ready || busy) return;
		setBusy(true);
		setProblem(null);
		try {
			await onApply(await render(ready.image, crop));
			onClose();
		} catch (error) {
			setProblem(
				error instanceof ApiError
					? error.message
					: "Não deu para salvar a foto. Tente de novo.",
			);
		} finally {
			setBusy(false);
		}
	}

	const scale = cropScale(width, height, VIEW, crop.zoom);

	return (
		<Dialog
			open={file !== null}
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent>
				<DialogTitle>Recortar a foto</DialogTitle>
				<DialogDescription>
					Arraste para ajustar e use o zoom. O grupo vê o que ficar no círculo.
				</DialogDescription>

				<div className="flex flex-col items-center gap-4">
					{loaded.status === "failed" ? (
						<p
							role="alert"
							className="flex items-center justify-center rounded-full bg-background text-center text-sm text-destructive-text"
							style={{ width: VIEW, height: VIEW }}
						>
							Não deu para abrir essa imagem.
						</p>
					) : (
						<div
							role="application"
							aria-label="Posição da foto. Use as setas para mover."
							tabIndex={0}
							onPointerDown={onPointerDown}
							onPointerMove={onPointerMove}
							onPointerUp={() => {
								drag.current = null;
							}}
							onPointerCancel={() => {
								drag.current = null;
							}}
							onWheel={onWheel}
							onKeyDown={onKeyDown}
							className="relative cursor-grab touch-none overflow-hidden rounded-full bg-background select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:cursor-grabbing"
							style={{ width: VIEW, height: VIEW }}
						>
							{ready && (
								<img
									src={ready.url}
									alt=""
									draggable={false}
									className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
									style={{
										width: width * scale,
										height: height * scale,
										transform: `translate(calc(-50% + ${crop.x}px), calc(-50% + ${crop.y}px))`,
									}}
								/>
							)}
						</div>
					)}

					<div className="flex w-full max-w-[280px] items-center gap-3 text-muted-foreground">
						<MinusIcon aria-hidden="true" className="size-4 shrink-0" />
						<Slider
							aria-label="Zoom"
							min={ZOOM_MIN}
							max={ZOOM_MAX}
							step={0.01}
							value={crop.zoom}
							disabled={!ready}
							onValueChange={(value) =>
								change({ ...crop, zoom: value as number })
							}
						/>
						<PlusIcon aria-hidden="true" className="size-4 shrink-0" />
					</div>
				</div>

				{problem && (
					<p role="alert" className="text-sm text-destructive-text">
						{problem}
					</p>
				)}

				<DialogFooter>
					<DialogClose render={<Button variant="ghost" disabled={busy} />}>
						Cancelar
					</DialogClose>
					<Button onClick={apply} disabled={!ready || busy}>
						{busy ? "Salvando…" : "Aplicar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

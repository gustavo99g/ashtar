import type { TrackReference } from "@livekit/components-react";
import { VideoQuality } from "livekit-client";
import { CheckIcon, CopyIcon, SignalIcon } from "lucide-react";
import {
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useInboundShareStats } from "../hooks/useInboundShareStats";
import { captureFrame, copyImage } from "../model/frame";
import {
	formatBitrate,
	formatResolution,
	INBOUND_SENTENCES,
	inboundHealth,
} from "../model/inboundHealth";
import {
	clampZoom,
	isZoomed,
	NO_ZOOM,
	panBy,
	type Size,
	wheelFactor,
	type Zoom,
	zoomAt,
	zoomLabel,
	zoomTransform,
} from "../model/zoom";

/*
 * As ferramentas da transmissão em foco (ADR 0024, combinado em 19/11): ampliar, ver como está
 * chegando e copiar um quadro. Só existem nela, também em tela cheia; lado a lado, no 2×2, na
 * fileira de baixo e na miniatura, não aparecem.
 */

function sizeOf(element: HTMLElement): Size {
	const rect = element.getBoundingClientRect();
	return { width: rect.width, height: rect.height };
}

/**
 * O vídeo que amplia: a roda amplia em volta do mouse (1× a 4×), arrastar move a imagem ampliada
 * sem deixar borda vazia, e o duplo clique ou o "2,5×" no topo voltam ao 1×. Só mexe no desenho: a
 * assinatura continua a mesma. Sair do foco desmonta, e o zoom volta ao 1×.
 */
export function ZoomableVideo({ children }: { children: ReactNode }) {
	const box = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
	const drag = useRef<{ x: number; y: number } | null>(null);
	const zoomed = isZoomed(zoom);

	// A roda precisa de `passive: false` para não rolar a página junto.
	useEffect(() => {
		const element = box.current;
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = element.getBoundingClientRect();
			const point = {
				x: event.clientX - (rect.left + rect.width / 2),
				y: event.clientY - (rect.top + rect.height / 2),
			};
			setZoom((current) =>
				zoomAt(current, wheelFactor(event.deltaY), point, sizeOf(element)),
			);
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, []);

	// O bloco mudou de tamanho (tela cheia, janela): prende de novo.
	useEffect(() => {
		const element = box.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() =>
			setZoom((current) => clampZoom(current, sizeOf(element))),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (!zoomed || event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { x: event.clientX, y: event.clientY };
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const from = drag.current;
		const element = box.current;
		if (!from || !element) return;
		drag.current = { x: event.clientX, y: event.clientY };
		setZoom((current) =>
			panBy(current, event.clientX - from.x, event.clientY - from.y, sizeOf(element)),
		);
	};
	const onPointerUp = () => {
		drag.current = null;
	};

	return (
		<div
			ref={box}
			data-testid="zoomable-video"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onDoubleClick={() => setZoom(NO_ZOOM)}
			className={cn(
				"relative size-full overflow-hidden",
				zoomed && "cursor-grab active:cursor-grabbing",
			)}
		>
			<div
				className="size-full"
				style={{ transform: zoomTransform(zoom), transformOrigin: "center" }}
			>
				{children}
			</div>
			{zoomed && (
				<button
					type="button"
					aria-label="Voltar ao 1×"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={() => setZoom(NO_ZOOM)}
					className="absolute top-3.5 left-1/2 -translate-x-1/2 rounded-lg bg-rail/85 px-2.5 py-1 font-mono text-xs font-semibold text-foreground hover:bg-secondary"
				>
					{zoomLabel(zoom)} · 1×
				</button>
			)}
		</div>
	);
}

const TOOL_BUTTON =
	"flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-rail/85 px-2.5 text-foreground hover:bg-secondary [&_svg]:size-4";

/** A camada que chega: "Única" sem camadas publicadas (o caminho nativo de hoje). */
function layerOf(share: TrackReference): string {
	if (!share.publication.simulcasted) return "Única";
	const quality = (share.publication as { videoQuality?: VideoQuality })
		.videoQuality;
	return quality === VideoQuality.LOW ? "Leve" : "Alta";
}

/**
 * O ícone de sinal que só aparece com o mouse em cima e abre "Como está chegando": a frase do topo
 * e os números. Fechado, nenhuma estatística é lida (`useInboundShareStats`).
 */
export function InboundStatsButton({ share }: { share: TrackReference }) {
	const [open, setOpen] = useState(false);
	const summary = useInboundShareStats(share, open);
	const health = inboundHealth(summary, share.publication.isMuted);
	const rows: [string, string][] = summary
		? [
				["Resolução", formatResolution(summary)],
				["Quadros", `${summary.fps} fps`],
				["Taxa", formatBitrate(summary.kbps)],
				["Perda", `${String(summary.lossPercent).replace(".", ",")}%`],
				["Atraso", `${summary.delayMs} ms`],
				["Camada", layerOf(share)],
			]
		: [];

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label="Como está chegando"
				className={cn(
					TOOL_BUTTON,
					"w-9 px-0 opacity-0 transition-opacity group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 data-popup-open:opacity-100",
				)}
			>
				<SignalIcon aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
			>
				<PopoverHeader>
					<PopoverTitle>Como está chegando</PopoverTitle>
					<PopoverDescription
						className={cn(
							(health === "loss" || health === "computer" || health === "delay") &&
								"text-live",
						)}
					>
						{INBOUND_SENTENCES[health]}
					</PopoverDescription>
				</PopoverHeader>
				{rows.length > 0 && (
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
						{rows.map(([label, value]) => (
							<div key={label} className="contents">
								<dt className="text-muted-foreground">{label}</dt>
								<dd className="text-right font-mono text-foreground">{value}</dd>
							</div>
						))}
					</dl>
				)}
			</PopoverContent>
		</Popover>
	);
}

type CopyState = "idle" | "copied" | "failed";

/**
 * Copia o quadro atual, no tamanho que chega (mesmo ampliado), como PNG. O "Quadro copiado" aparece
 * no próprio botão e some sozinho: um aviso fora do bloco não apareceria em tela cheia.
 */
export function CopyFrameButton({
	videoOf,
}: {
	/** O `<video>` da transmissão, na hora do clique. */
	videoOf: () => HTMLVideoElement | null;
}) {
	const [state, setState] = useState<CopyState>("idle");

	useEffect(() => {
		if (state === "idle") return;
		const timer = window.setTimeout(() => setState("idle"), 2000);
		return () => window.clearTimeout(timer);
	}, [state]);

	const copy = async () => {
		const video = videoOf();
		const png = video ? await captureFrame(video) : null;
		if (!png) {
			setState("failed");
			return;
		}
		try {
			await copyImage(png);
			setState("copied");
		} catch {
			setState("failed");
		}
	};

	return (
		<button
			type="button"
			aria-label="Copiar um quadro"
			onClick={() => void copy()}
			className={cn(TOOL_BUTTON, state === "idle" && "w-9 px-0")}
		>
			{state === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
			{state !== "idle" && (
				<span role="status" className="text-xs font-semibold">
					{state === "copied" ? "Quadro copiado" : "Não deu para copiar"}
				</span>
			)}
		</button>
	);
}

import { type PointerEvent, useRef } from "react";
import { cn } from "@/lib/utils";

/*
 * A onda do som: barras de 0 a 1. No editor, com as duas alças douradas do trecho (arrastar move o
 * início ou o fim) e o trecho em dourado; fora dele, só as barras (a fila de aprovação).
 */

export function Waveform({
	bars,
	selection,
	onSelect,
	className,
}: {
	bars: number[];
	/** O trecho escolhido, de 0 a 1 do arquivo. */
	selection?: { start: number; end: number };
	/** Arrastou uma alça: o novo início ou fim, de 0 a 1. */
	onSelect?: (edge: "start" | "end", at: number) => void;
	className?: string;
}) {
	const box = useRef<HTMLDivElement>(null);
	const dragging = useRef<"start" | "end" | null>(null);

	function position(event: PointerEvent): number {
		const rect = box.current?.getBoundingClientRect();
		if (!rect || rect.width === 0) return 0;
		return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
	}

	function grab(edge: "start" | "end") {
		return (event: PointerEvent<HTMLButtonElement>) => {
			dragging.current = edge;
			event.currentTarget.setPointerCapture(event.pointerId);
		};
	}

	function move(event: PointerEvent) {
		if (dragging.current) onSelect?.(dragging.current, position(event));
	}

	const inside = (index: number) => {
		if (!selection) return true;
		const at = (index + 0.5) / bars.length;
		return at >= selection.start && at <= selection.end;
	};

	return (
		<div
			ref={box}
			className={cn("relative flex h-20 items-center gap-[2px]", className)}
			onPointerMove={move}
			onPointerUp={() => {
				dragging.current = null;
			}}
		>
			{bars.map((bar, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: as barras são fixas.
					key={index}
					aria-hidden="true"
					className={cn(
						"min-w-px flex-1 rounded-full",
						inside(index) ? "bg-gold" : "bg-border-strong",
					)}
					style={{ height: `${Math.max(6, bar * 100)}%` }}
				/>
			))}
			{selection && onSelect && (
				<>
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 border-y-2 border-gold"
						style={{
							left: `${selection.start * 100}%`,
							right: `${(1 - selection.end) * 100}%`,
						}}
					/>
					{(["start", "end"] as const).map((edge) => (
						<button
							key={edge}
							type="button"
							aria-label={edge === "start" ? "Início do trecho" : "Fim do trecho"}
							onPointerDown={grab(edge)}
							onKeyDown={(event) => {
								const step = event.shiftKey ? 0.05 : 0.01;
								const at = edge === "start" ? selection.start : selection.end;
								if (event.key === "ArrowLeft") onSelect(edge, at - step);
								if (event.key === "ArrowRight") onSelect(edge, at + step);
							}}
							className="absolute -inset-y-1 w-2 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm bg-gold focus-visible:outline-2 focus-visible:outline-focus"
							style={{
								left: `${(edge === "start" ? selection.start : selection.end) * 100}%`,
							}}
						/>
					))}
				</>
			)}
		</div>
	);
}

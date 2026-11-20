import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";
import type { InputLevel } from "../../input/model/levelBus";
import { MIN_THRESHOLD_DB } from "../../input/stores/inputStore";

/** De -100 dBFS (0%) a 0 (100%). */
function percent(db: number): number {
	return Math.max(0, Math.min(100, ((db - MIN_THRESHOLD_DB) / -MIN_THRESHOLD_DB) * 100));
}

/**
 * A régua da sensibilidade: a barra azul é o nível do microfone agora, a marca dourada é o limite a
 * partir do qual a voz passa. Com o automático, a marca anda sozinha; sem ele, é arrastável (e
 * anda com as setas do teclado).
 */
export function SensitivityBar({
	level,
	auto,
	thresholdDb,
	onThresholdChange,
}: {
	level: InputLevel | null;
	auto: boolean;
	thresholdDb: number;
	onThresholdChange: (thresholdDb: number) => void;
}) {
	// Com o automático, a marca é a que o portão calcula; sem medição ainda, fica escondida.
	const mark = auto ? (level?.threshold ?? null) : thresholdDb;
	const fill = level ? percent(level.level) : 0;
	const fillClass = cn(
		"absolute inset-y-0 left-0 rounded-full transition-[width] duration-75",
		level?.open ? "bg-primary" : "bg-primary/45",
	);

	if (auto) {
		return (
			<div
				role="img"
				aria-label="Sensibilidade automática"
				className="relative my-1 h-2 rounded-full bg-border"
			>
				<span className={fillClass} style={{ width: `${fill}%` }} />
				{mark !== null && (
					<span
						className="absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-[2px] bg-gold"
						style={{ left: `${percent(mark)}%` }}
					/>
				)}
			</div>
		);
	}

	return (
		<SliderPrimitive.Root
			min={MIN_THRESHOLD_DB}
			max={0}
			step={1}
			value={thresholdDb}
			onValueChange={(next) => onThresholdChange(next as number)}
			className="w-full"
		>
			<SliderPrimitive.Control className="flex w-full cursor-pointer touch-none items-center py-1 select-none">
				<SliderPrimitive.Track className="relative h-2 w-full rounded-full bg-border select-none">
					<span className={fillClass} style={{ width: `${fill}%` }} />
					<SliderPrimitive.Thumb
						aria-label="Sensibilidade"
						getAriaValueText={(_, value) => `${value} dB`}
						className="h-4 w-[5px] rounded-[2px] bg-gold select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
					/>
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

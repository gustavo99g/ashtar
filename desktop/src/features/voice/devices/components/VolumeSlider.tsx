import { useId } from "react";
import { Slider } from "@/components/ui/slider";

/** O volume de entrada ou de saída, de 0 a 200%, embaixo do seletor do dispositivo. */
export function VolumeSlider({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
}) {
	const id = useId();
	return (
		<div className="mt-1.5 flex flex-col gap-1">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span id={id}>{label}</span>
				<span className="tabular-nums">{Math.round(value)}%</span>
			</div>
			<Slider
				aria-label={label}
				min={0}
				max={200}
				step={1}
				value={value}
				onValueChange={(next) => onChange(next as number)}
			/>
		</div>
	);
}

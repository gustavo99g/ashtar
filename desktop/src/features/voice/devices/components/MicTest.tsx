import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInputLevel } from "../../input/hooks/useInputLevel";
import { useMicTest } from "../../input/hooks/useMicTest";
import { SILENCE_DB } from "../../input/model/gate";

const BARS = 20;

/** Quantas das 20 barras um nível acende: de -100 dBFS (nenhuma) a 0 (todas). */
export function litBars(levelDb: number | null): number {
	if (levelDb === null) return 0;
	const fraction = (levelDb - SILENCE_DB) / -SILENCE_DB;
	return Math.max(0, Math.min(BARS, Math.round(fraction * BARS)));
}

/** "Testar microfone" e o medidor de 20 barras (quadro "Configurações — voz e vídeo"). */
export function MicTest() {
	const test = useMicTest();
	const level = useInputLevel();
	const lit = test.testing ? litBars(level?.level ?? null) : 0;
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-4">
				<Button
					variant="outline"
					className="shrink-0"
					onClick={test.toggle}
					aria-pressed={test.testing}
				>
					{test.testing ? "Parar de testar" : "Testar microfone"}
				</Button>
				<div
					role="meter"
					aria-label="Nível do microfone"
					aria-valuemin={0}
					aria-valuemax={BARS}
					aria-valuenow={lit}
					className="flex h-3 grow gap-[3px]"
				>
					{Array.from({ length: BARS }, (_, index) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: as barras são fixas.
							key={index}
							className={cn(
								"grow rounded-[2px] transition-colors duration-75",
								index < lit
									? level?.open
										? "bg-primary"
										: "bg-primary/45"
									: "bg-border",
							)}
						/>
					))}
				</div>
			</div>
			{test.testing && test.inRoom && (
				<p className="text-xs text-muted-foreground">
					Na sala, o teste só mostra o nível: o seu som não volta para você,
					para não virar eco para os outros.
				</p>
			)}
			{test.failed && (
				<p className="text-xs text-warning-text">
					Não foi possível abrir o microfone. Confira se ele está conectado e
					se o Windows deixa o Ashtar usá-lo.
				</p>
			)}
		</div>
	);
}

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

/*
 * Controle deslizante de um valor só (o volume da transmissão): trilho fino, a parte cheia em azul
 * e a bolinha clara. Arrasta com o mouse e anda com as setas do teclado (Page Up e Page Down vão de
 * 10 em 10). O nome acessível vai na bolinha, que é o que recebe o foco. Componente nosso, montado
 * no Base UI.
 */

interface SliderProps
	extends Omit<SliderPrimitive.Root.Props<number>, "aria-label"> {
	"aria-label": string;
}

function Slider({ className, "aria-label": label, ...props }: SliderProps) {
	return (
		<SliderPrimitive.Root
			data-slot="slider"
			className={cn("w-full", className)}
			{...props}
		>
			<SliderPrimitive.Control className="flex w-full touch-none items-center py-2 select-none">
				<SliderPrimitive.Track className="h-1 w-full rounded-full bg-border-strong select-none">
					<SliderPrimitive.Indicator className="rounded-full bg-primary select-none" />
					<SliderPrimitive.Thumb
						aria-label={label}
						className="size-3 rounded-full bg-foreground select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
					/>
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

export { Slider };

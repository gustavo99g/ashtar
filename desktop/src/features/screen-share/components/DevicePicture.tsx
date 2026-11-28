/**
 * A imagem de um aparelho de transmissão (ADR 0038): a foto do Odin 3, recortada, quando o nome do
 * aparelho diz que é um; o controle genérico para os outros. Vai na lista da sala e em
 * Configurações › Dispositivos.
 */
import { GamepadIcon } from "lucide-react";
import odin from "@/assets/odin3.png";
import { cn } from "@/lib/utils";

/** O aparelho é um Odin, pelo nome (o modelo que o Android deu, ou o que a pessoa escolheu). */
export function isOdin(name: string): boolean {
	return /odin|ayn/i.test(name);
}

/**
 * `size` é a altura do espaço da imagem, como a de um avatar. A foto do Odin é deitada (2,5 : 1),
 * então ocupa mais largura que um avatar; o controle fica num círculo do tamanho do avatar.
 */
export function DevicePicture({
	name,
	size,
	className,
}: {
	name: string;
	size: number;
	className?: string;
}) {
	if (isOdin(name)) {
		return (
			<img
				src={odin}
				alt=""
				aria-hidden="true"
				draggable={false}
				style={{ width: Math.round(size * 1.6) }}
				className={cn(
					"h-auto shrink-0 select-none drop-shadow-[0_0_1px_rgba(255,255,255,0.35)]",
					className,
				)}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			style={{ width: size, height: size }}
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground",
				className,
			)}
		>
			<GamepadIcon style={{ width: size * 0.6, height: size * 0.6 }} />
		</span>
	);
}

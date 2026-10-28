/*
 * O céu do fundo da entrada: duas órbitas apagadas e algumas estrelas, só decoração. As medidas
 * são as do canvas (1440 × 868, a área abaixo da barra de título), e o desenho cobre a janela em
 * qualquer tamanho, cortando as bordas.
 */

/** Pontos: x, y, raio e opacidade. */
const DOTS = [
	[115, 121, 1.2, 0.35],
	[244, 624, 1, 0.25],
	[388, 269, 1.4, 0.3],
	[489, 763, 1, 0.2],
	[892, 78, 1.2, 0.3],
	[1022, 685, 1.4, 0.25],
	[1195, 208, 1, 0.35],
	[1310, 529, 1.2, 0.25],
	[72, 407, 1, 0.2],
	[1368, 781, 1, 0.2],
	[648, 52, 1, 0.2],
	[806, 807, 1.2, 0.2],
] as const;

/** Brilhos de quatro pontas: x, y, tamanho e opacidade. */
const SPARKLES = [
	[273, 190, 6, 0.35],
	[1238, 329, 5, 0.3],
	[1094, 746, 7, 0.25],
	[158, 729, 4, 0.3],
] as const;

function sparkle(x: number, y: number, s: number): string {
	return `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;
}

export function EntrySky() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 1440 868"
			preserveAspectRatio="xMidYMid slice"
			fill="none"
			className="pointer-events-none absolute inset-0 size-full"
		>
			<ellipse
				cx={720}
				cy={434}
				rx={619}
				ry={217}
				transform="rotate(-16 720 434)"
				className="stroke-foreground"
				strokeOpacity={0.05}
				strokeWidth={2}
			/>
			<ellipse
				cx={720}
				cy={434}
				rx={446}
				ry={143}
				transform="rotate(-16 720 434)"
				className="stroke-primary"
				strokeOpacity={0.14}
				strokeWidth={1.5}
			/>
			<g className="fill-foreground">
				{DOTS.map(([x, y, r, opacity]) => (
					<circle key={`${x}-${y}`} cx={x} cy={y} r={r} fillOpacity={opacity} />
				))}
				{SPARKLES.map(([x, y, s, opacity]) => (
					<path key={`${x}-${y}`} d={sparkle(x, y, s)} fillOpacity={opacity} />
				))}
			</g>
		</svg>
	);
}

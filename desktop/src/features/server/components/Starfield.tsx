/*
 * O fundo da tela do servidor: duas órbitas e umas estrelas, como no canvas. Só enfeite: fica
 * centralizado atrás do conteúdo e não recebe clique.
 */

const DOTS: [x: number, y: number, r: number, opacity: number][] = [
	[96, 114, 1.2, 0.35],
	[204, 590, 1, 0.25],
	[324, 254, 1.4, 0.3],
	[408, 721, 1, 0.2],
	[744, 73, 1.2, 0.3],
	[852, 647, 1.4, 0.25],
	[996, 196, 1, 0.35],
	[1092, 500, 1.2, 0.25],
	[60, 385, 1, 0.2],
	[1140, 738, 1, 0.2],
	[540, 49, 1, 0.2],
	[672, 762, 1.2, 0.2],
];

/** Estrelas de quatro pontas: centro e meia altura. */
const SPARKS: [x: number, y: number, half: number, opacity: number][] = [
	[228, 180, 6, 0.35],
	[1032, 311, 5, 0.3],
	[912, 705, 7, 0.25],
	[132, 688, 4, 0.3],
];

function spark(x: number, y: number, h: number): string {
	return `M${x} ${y - h}Q${x} ${y} ${x + h} ${y}Q${x} ${y} ${x} ${y + h}Q${x} ${y} ${x - h} ${y}Q${x} ${y} ${x} ${y - h}Z`;
}

export function Starfield() {
	return (
		<svg
			width="1200"
			height="820"
			viewBox="0 0 1200 820"
			fill="none"
			aria-hidden="true"
			className="pointer-events-none absolute top-1/2 left-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
		>
			<ellipse
				cx="600"
				cy="410"
				rx="516"
				ry="205"
				transform="rotate(-16 600 410)"
				className="stroke-link-hover"
				strokeOpacity="0.05"
				strokeWidth="2"
			/>
			<ellipse
				cx="600"
				cy="410"
				rx="372"
				ry="135"
				transform="rotate(-16 600 410)"
				className="stroke-primary"
				strokeOpacity="0.14"
				strokeWidth="1.5"
			/>
			<g className="fill-foreground">
				{DOTS.map(([x, y, r, opacity]) => (
					<circle key={`${x}-${y}`} cx={x} cy={y} r={r} fillOpacity={opacity} />
				))}
				{SPARKS.map(([x, y, half, opacity]) => (
					<path key={`${x}-${y}`} d={spark(x, y, half)} fillOpacity={opacity} />
				))}
			</g>
		</svg>
	);
}

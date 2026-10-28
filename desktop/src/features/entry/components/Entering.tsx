import logo from "@/assets/ashtar.svg";

/** O `id` do título de "Entrando…", para o `aria-labelledby` do `EntryScreen`. */
export const ENTERING_TITLE_ID = "entrando-titulo";

/**
 * "Entrando…": o ícone com o anel girando. Aparece enquanto o app faz o login pela chave e
 * enquanto lê o convite de um link.
 */
export function Entering() {
	return (
		<div
			role="status"
			className="flex flex-col items-center gap-4 py-2 text-center"
		>
			<div className="relative flex size-[72px] items-center justify-center">
				<svg
					aria-hidden="true"
					viewBox="0 0 72 72"
					fill="none"
					className="absolute inset-0 size-full animate-spin"
				>
					<circle
						cx={36}
						cy={36}
						r={34}
						className="stroke-border"
						strokeWidth={3}
					/>
					<path
						d="M36 2a34 34 0 0134 34"
						className="stroke-ring"
						strokeWidth={3}
						strokeLinecap="round"
					/>
				</svg>
				<img src={logo} alt="" className="size-12 rounded-2xl" />
			</div>
			<div className="flex flex-col gap-1.5">
				<h1
					id={ENTERING_TITLE_ID}
					className="text-[22px] leading-[1.3] font-bold text-balance text-foreground"
				>
					Entrando…
				</h1>
				<p className="text-sm leading-[1.55] text-balance text-muted-foreground">
					Se este computador já tem conta, o Ashtar entra sozinho.
				</p>
			</div>
		</div>
	);
}

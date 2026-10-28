import type { ReactNode } from "react";

interface EntryMessageProps {
	/** O `id` do título, que o `EntryScreen` usa no `aria-labelledby`. */
	titleId: string;
	/** O avatar ou o ícone redondo de cima. */
	media: ReactNode;
	title: ReactNode;
	description: ReactNode;
	/** O botão (ou os botões) embaixo. */
	action: ReactNode;
	/** `alert` nos erros, para o leitor de tela anunciar. */
	role?: "alert";
}

/**
 * Um recado centralizado no cartão da entrada: ícone, título, texto e botão. É o formato de
 * "Você já está no Ashtar", das boas-vindas da recuperação e dos estados e erros.
 */
export function EntryMessage({
	titleId,
	media,
	title,
	description,
	action,
	role,
}: EntryMessageProps) {
	return (
		<div role={role} className="flex flex-col items-stretch gap-6">
			<div className="flex flex-col items-center gap-4 text-center">
				{media}
				<div className="flex flex-col gap-1.5">
					<h1
						id={titleId}
						className="text-[22px] leading-[1.3] font-bold text-balance text-foreground"
					>
						{title}
					</h1>
					<div className="text-sm leading-[1.55] text-balance text-muted-foreground">
						{description}
					</div>
				</div>
			</div>
			{action}
		</div>
	);
}

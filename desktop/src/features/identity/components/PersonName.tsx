import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface PersonNameProps extends ComponentProps<"span"> {
	/**
	 * O nome é o do dono: dourado, como a coroa do Painel. O dourado é só dele, por isso o nome
	 * comum não o usa.
	 */
	owner?: boolean;
}

/**
 * O nick ou o nome visível de alguém no meio de um texto: em negrito e mais claro que o resto da
 * frase (`text-foreground` contra o cinza-azulado do texto em volta), para se destacar. Use sempre
 * que uma pessoa aparecer escrita ("kid te convidou", "Conta de juju"), e nunca para o texto de um
 * botão, que já tem a sua cor.
 *
 * Só a cor e o peso: o texto é o que a tela passar (o nick, ou o nome visível quando a tela o usa).
 */
export function PersonName({
	owner = false,
	className,
	...props
}: PersonNameProps) {
	return (
		<span
			data-slot="person-name"
			data-owner={owner ? "" : undefined}
			className={cn(
				"font-semibold",
				owner ? "text-gold" : "text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

import type { ReactNode } from "react";
import { Avatar } from "@/features/identity";
import { cn } from "@/lib/utils";

interface PersonCardProps {
	/** O nick da pessoa: dá a cor e a letra do avatar. */
	nick: string;
	/** A linha de cima ("kid te convidou para o Ashtar", "Conta de juju"). */
	children: ReactNode;
	/** A linha de baixo, menor. */
	detail: ReactNode;
	/** O avatar apagado, de uma conta que já não está neste computador. */
	faded?: boolean;
}

/**
 * A caixa com o avatar e duas linhas: quem convidou, de quem é a conta. Na entrada, a pessoa
 * aparece pelo nick, que é o que identifica a conta, e a letra do avatar também sai dele.
 */
export function PersonCard({
	nick,
	children,
	detail,
	faded = false,
}: PersonCardProps) {
	return (
		<div className="flex items-center gap-3 rounded-xl border border-border-strong bg-secondary px-4 py-3.5 text-left">
			<Avatar nick={nick} size={40} className={cn(faded && "opacity-55")} />
			<div className="flex min-w-0 flex-col gap-[3px]">
				<span className="text-sm leading-[1.4] text-secondary-foreground">
					{children}
				</span>
				<span className="flex items-center gap-[5px] text-xs text-muted-foreground">
					{detail}
				</span>
			</div>
		</div>
	);
}

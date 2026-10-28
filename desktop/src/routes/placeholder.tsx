import { ConstructionIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { paths } from "@/lib/paths";

/*
 * Lugar provisório de uma tela que ainda não existe. Cada etapa troca o seu por a tela de
 * verdade; a Etapa 7, que entrega as últimas, apaga este arquivo.
 */

/** Atalhos para andar entre as rotas enquanto as telas não existem. */
const LINKS: [label: string, to: string][] = [
	["Entrando…", paths.start],
	["Sem convite", paths.entry.noInvite],
	["Escolha do nick", paths.entry.invite("7KQ2-M9XD-4HPA")],
	["Recuperação", paths.entry.recovery("3RTW-8NB5-QZ6C")],
	["Você já está no Ashtar", paths.entry.alreadyIn],
	["Saiu do grupo", paths.entry.leftGroup],
	["Servidor", paths.server],
	["Sala", paths.voiceRoom],
	["Configurações", paths.settings.profile],
];

export function RoutePlaceholder({
	title,
	stage,
}: {
	title: string;
	stage: number;
}) {
	return (
		<div className="grid h-full place-items-center p-8">
			<EmptyState
				icon={<ConstructionIcon />}
				title={title}
				description={`Esta tela chega na Etapa ${stage}.`}
				action={
					<nav
						aria-label="Rotas provisórias"
						className="flex max-w-md flex-wrap justify-center gap-x-3"
					>
						{LINKS.map(([label, to]) => (
							<Link
								key={to}
								to={to}
								className={buttonVariants({ variant: "link", size: "sm" })}
							>
								{label}
							</Link>
						))}
					</nav>
				}
			/>
		</div>
	);
}

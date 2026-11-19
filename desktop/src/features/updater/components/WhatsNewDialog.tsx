/**
 * "O que há de novo" (decisão 9 do PLAN da v0.2.0; quadro "Atualização: o que há de novo"): na
 * primeira abertura depois de mudar de versão, mostra a seção do CHANGELOG.md uma vez e guarda a
 * versão como vista. Quem pulou versões vê todas desde a última vista, cada uma com o seu título,
 * da mais nova para a mais velha (v0.4). O link da tela Aplicativo abre a mesma janela. Entendi, Esc ou clicar fora
 * fecha. Uma lista longa rola por dentro, com o título e o Entendi sempre à vista.
 */
import { SparklesIcon } from "lucide-react";
import { useEffect } from "react";
import logo from "@/assets/ashtar.svg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { closeWhatsNew, showWhatsNewOnce, useUpdaterStore } from "../stores/updaterStore";

export function WhatsNewDialog() {
	const content = useUpdaterStore((state) => state.whatsNew);
	const open = useUpdaterStore((state) => state.whatsNewOpen);

	useEffect(() => {
		void showWhatsNewOnce();
	}, []);

	const sections = content?.sections ?? [];
	const several = sections.length > 1;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) closeWhatsNew();
			}}
		>
			<DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
				<div
					aria-hidden="true"
					className="flex h-24 shrink-0 items-end justify-center bg-[radial-gradient(ellipse_70%_120%_at_50%_0%,color-mix(in_srgb,var(--color-primary)_45%,transparent),transparent_70%)]"
				>
					<img
						src={logo}
						alt=""
						className="-mb-5 size-16 rounded-2xl ring-4 ring-card"
					/>
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-[22px] px-8 pt-9 pb-7">
					<div className="flex flex-col items-center gap-2 text-center">
						<Badge
							tone="info"
							className="gap-1.5 text-[11px] font-bold tracking-[0.04em] uppercase"
						>
							<SparklesIcon />
							Atualizado
						</Badge>
						<DialogTitle className="text-[22px]">
							O que há de novo na {content?.version}
						</DialogTitle>
					</div>
					<div className="-mr-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-4">
						{sections.map((section) => (
							<section
								key={section.version}
								aria-label={several ? `Versão ${section.version}` : undefined}
								className="flex flex-col gap-2.5"
							>
								{several && (
									<h3 className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
										{section.version}
									</h3>
								)}
								<ul className="flex flex-col gap-2.5">
									{noteItems(section.notes).map((item, index) => (
										<li
											key={index}
											className="flex gap-3 text-sm leading-normal text-secondary-foreground"
										>
											<span
												aria-hidden="true"
												className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
											/>
											{item}
										</li>
									))}
								</ul>
							</section>
						))}
					</div>
					<Button size="lg" className="w-full shrink-0" onClick={closeWhatsNew}>
						Entendi
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** As linhas `- ` da seção, sem o traço. */
function noteItems(notes: string): string[] {
	return notes
		.split("\n")
		.map((line) => line.replace(/^\s*-\s*/, "").trim())
		.filter((line) => line.length > 0);
}

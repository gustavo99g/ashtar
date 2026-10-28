/**
 * "O que há de novo" (decisão 9 do PLAN): na primeira abertura depois de mudar de versão, mostra a
 * seção do CHANGELOG.md uma vez e guarda a versão como vista.
 *
 * A última versão vista fica no localStorage, que é da pasta de dados do app (identificador): o app
 * instalado e o de desenvolvimento não se misturam.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { type WhatsNew, whatsNew } from "@/lib/tauri/commands";

const LAST_SEEN_KEY = "ashtar.lastSeenVersion";

export function WhatsNewDialog() {
	const [content, setContent] = useState<WhatsNew | null>(null);

	useEffect(() => {
		let cancelled = false;

		void whatsNew().then((current) => {
			if (cancelled || !current) return;
			if (localStorage.getItem(LAST_SEEN_KEY) === current.version) return;
			setContent(current);
		});

		return () => {
			cancelled = true;
		};
	}, []);

	if (!content) {
		return null;
	}

	/** Qualquer jeito de fechar (o botão, o ESC, clicar fora) conta como visto. */
	function close() {
		if (content) {
			localStorage.setItem(LAST_SEEN_KEY, content.version);
		}
		setContent(null);
	}

	// Uma linha por item, como o CHANGELOG.md escreve: o `- ` do começo não aparece.
	const items = content.notes
		.split("\n")
		.map((line) => line.replace(/^\s*-\s*/, "").trim())
		.filter((line) => line.length > 0);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent className="flex max-h-[calc(100%-2rem)] flex-col gap-5 rounded-[14px] border-border p-6 sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle className="text-xl">
						O que há de novo na {content.version}
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-normal">
						Veja o que mudou desde a última vez que você abriu o Ashtar.
					</DialogDescription>
				</DialogHeader>
				<ul className="-mr-2 flex min-h-0 flex-col gap-2.5 overflow-y-auto pr-2 pl-5 text-sm leading-[1.55] text-secondary-foreground marker:text-foreground-subtle">
					{items.map((item) => (
						<li key={item} className="list-disc">
							{item}
						</li>
					))}
				</ul>
				<DialogFooter>
					<Button size="lg" onClick={close}>
						Entendi
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

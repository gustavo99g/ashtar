/**
 * "O que há de novo" (decisão 9 do PLAN): na primeira abertura depois de mudar de versão, mostra a
 * seção do CHANGELOG.md uma vez e guarda a versão como vista.
 *
 * A última versão vista fica no localStorage, que é da pasta de dados do app (identificador): o app
 * instalado e o de desenvolvimento não se misturam.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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

	function close() {
		if (content) {
			localStorage.setItem(LAST_SEEN_KEY, content.version);
		}
		setContent(null);
	}

	const items = content.notes
		.split("\n")
		.map((line) => line.replace(/^\s*-\s*/, "").trim())
		.filter((line) => line.length > 0);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="whats-new-title"
				className="w-full max-w-md rounded-lg border border-line bg-float p-6 text-primary shadow-xl"
			>
				<h2 id="whats-new-title" className="text-lg font-semibold">
					O que há de novo na {content.version}
				</h2>
				<ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-secondary">
					{items.map((item, index) => (
						<li key={index}>{item}</li>
					))}
				</ul>
				<div className="mt-6 flex justify-end">
					<Button onClick={close}>Entendi</Button>
				</div>
			</div>
		</div>
	);
}

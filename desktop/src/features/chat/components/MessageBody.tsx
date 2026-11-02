import { openLink } from "@/lib/tauri/opener";
import { bodyParts } from "../model/messages";

/**
 * O texto da mensagem, com as quebras de linha e os links clicáveis. Todo clique no link (o comum,
 * o do meio e o Ctrl+clique) passa pelo `openLink` e abre no navegador: deixado com o WebView, o
 * clique do meio abriria o link numa janela dentro do app.
 */
export function MessageBody({ body }: { body: string }) {
	return (
		<p className="text-sm leading-[1.55] break-words whitespace-pre-wrap text-secondary-foreground">
			{bodyParts(body).map((part, index) =>
				part.kind === "text" ? (
					<span key={index}>{part.text}</span>
				) : (
					<a
						key={index}
						href={part.url}
						onClick={(event) => {
							event.preventDefault();
							openLink(part.url);
						}}
						onAuxClick={(event) => {
							event.preventDefault();
							if (event.button === 1) openLink(part.url);
						}}
						className="text-link underline-offset-2 hover:underline"
					>
						{part.url}
					</a>
				),
			)}
		</p>
	);
}

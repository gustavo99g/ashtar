import { openLink } from "@/lib/tauri/opener";
import { authorName, bodyParts } from "../model/messages";
import type { Mentionable } from "../model/mentions";

/**
 * O texto da mensagem, com as quebras de linha, os links clicáveis e as menções. Todo clique no link
 * (o comum, o do meio e o Ctrl+clique) passa pelo `openLink` e abre no navegador: deixado com o
 * WebView, o clique do meio abriria o link numa janela dentro do app.
 *
 * A menção vira um selo com o nome visível de quem foi mencionado (o `@nick` escrito fica no
 * `title`). Só vira selo quem está em `mentioned`: quem a API confirmou.
 */
export function MessageBody({
	body,
	mentioned = [],
}: {
	body: string;
	mentioned?: readonly Mentionable[];
}) {
	return (
		<p className="text-sm leading-[1.55] break-words whitespace-pre-wrap text-secondary-foreground">
			{bodyParts(body, mentioned).map((part, index) =>
				part.kind === "text" ? (
					<span key={index}>{part.text}</span>
				) : part.kind === "mention" ? (
					<span
						key={index}
						title={part.text}
						className="rounded bg-primary/20 px-0.5 font-medium text-primary"
					>
						@{authorName(part.person)}
					</span>
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

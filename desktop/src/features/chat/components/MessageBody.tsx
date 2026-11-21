import { type KeyboardEvent, type ReactNode, useState } from "react";
import { CustomEmoji, useEmojiByName } from "@/features/emojis";
import type { Emoji } from "@/lib/api";
import { openLink } from "@/lib/tauri/opener";
import { cn } from "@/lib/utils";
import { emojiParts, onlyCustomEmojis } from "../model/customEmoji";
import { type MdNode, parseMarkdown } from "../model/markdown";
import type { Mentionable } from "../model/mentions";
import { authorName, bodyParts, stampLabel } from "../model/messages";

/**
 * O texto da mensagem, com as quebras de linha, o markdown básico (`model/markdown.ts`), os links
 * clicáveis e as menções. Todo clique no link (o comum, o do meio e o Ctrl+clique) passa pelo
 * `openLink` e abre no navegador: deixado com o WebView, o clique do meio abriria o link numa
 * janela dentro do app.
 *
 * A menção vira um selo com o nome visível de quem foi mencionado (o `@nick` escrito fica no
 * `title`). Só vira selo quem está em `mentioned`: quem a API confirmou.
 *
 * O `:nome:` de um emoji do grupo vira a imagem, do tamanho da letra, ou maior quando a mensagem
 * é só emojis do grupo.
 */
export function MessageBody({
	body,
	mentioned = [],
	editedAt = null,
}: {
	body: string;
	mentioned?: readonly Mentionable[];
	/** Quando foi editada: aparece "(editada)" no fim, com a hora no `title`. */
	editedAt?: number | null;
}) {
	const byName = useEmojiByName();
	const context: Context = {
		mentioned,
		byName,
		jumbo: onlyCustomEmojis(body, byName),
	};
	return (
		<div className="text-sm leading-[1.55] break-words whitespace-pre-wrap text-secondary-foreground">
			{renderNodes(parseMarkdown(body), context)}
			{editedAt !== null && (
				<span
					title={`Editada ${stampLabel(editedAt).toLowerCase()}`}
					className="ml-1 text-[11px] text-foreground-subtle"
				>
					(editada)
				</span>
			)}
		</div>
	);
}

interface Context {
	mentioned: readonly Mentionable[];
	byName: ReadonlyMap<string, Emoji>;
	jumbo: boolean;
}

function renderNodes(nodes: MdNode[], context: Context): ReactNode[] {
	return nodes.map((node, index) => {
		switch (node.kind) {
			case "text":
				return <TextWithLinks key={index} text={node.text} context={context} />;
			case "code":
				return (
					<code
						key={index}
						className="rounded bg-secondary px-[5px] py-px font-mono text-[12.5px] text-foreground"
					>
						{node.text}
					</code>
				);
			case "codeblock":
				return (
					<pre
						key={index}
						className="my-1.5 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] whitespace-pre text-foreground"
					>
						{node.text}
					</pre>
				);
			case "bold":
				return (
					<strong key={index} className="font-semibold text-foreground">
						{renderNodes(node.children, context)}
					</strong>
				);
			case "italic":
				return <em key={index}>{renderNodes(node.children, context)}</em>;
			case "spoiler":
				return (
					<Spoiler key={index}>{renderNodes(node.children, context)}</Spoiler>
				);
		}
	});
}

/**
 * O spoiler: escondido até o clique (ou Enter e espaço). Escondido, o que está dentro não recebe
 * clique nem foco: o primeiro clique só mostra.
 */
function Spoiler({ children }: { children: ReactNode }) {
	const [shown, setShown] = useState(false);
	if (shown) {
		return <span className="rounded bg-secondary px-[3px]">{children}</span>;
	}
	return (
		<span
			role="button"
			tabIndex={0}
			aria-label="Spoiler escondido, clique para mostrar"
			title="Clique para mostrar"
			onClick={() => setShown(true)}
			onKeyDown={(event: KeyboardEvent) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					setShown(true);
				}
			}}
			className={cn(
				"cursor-pointer rounded bg-border-strong px-[3px] text-transparent select-none hover:bg-accent",
				"[&_*]:pointer-events-none [&_*]:text-transparent [&_*]:!bg-transparent",
			)}
		>
			{/* Escondido, nem o leitor de tela nem o Tab chegam ao que está dentro. */}
			<span aria-hidden="true" inert>
				{children}
			</span>
		</span>
	);
}

function TextWithLinks({ text, context }: { text: string; context: Context }) {
	return bodyParts(text, context.mentioned).map((part, index) =>
		part.kind === "text" ? (
			<span key={index}>
				{emojiParts(part.text, context.byName).map((piece, at) =>
					piece.kind === "text" ? (
						piece.text
					) : (
						<CustomEmoji
							key={at}
							emoji={piece.emoji}
							className={context.jumbo ? "size-12" : undefined}
						/>
					),
				)}
			</span>
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
	);
}

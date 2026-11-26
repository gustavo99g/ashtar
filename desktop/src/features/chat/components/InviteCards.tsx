/**
 * O cartão do link de convite no chat (v0.9, decisões 4 a 7 do plano). A prévia da API nunca
 * busca o próprio servidor, então o app reconhece o link no texto e monta o cartão com a rota
 * `GET /api/invites/card/{código}`: quem convidou (ou de quem é a conta na recuperação), até
 * quando vale, e um convite que não vale mais fica apagado com o motivo. Quem lê já está no
 * grupo, então o cartão não tem botão de entrar: só Copiar link.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import logo from "@/assets/ashtar.svg";
import { formatValidUntil, type InviteLink } from "@/features/entry";
import {
	getInviteCard,
	type InviteCardStatus,
	type InviteCardView,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { inviteLinksIn } from "../model/inviteLinks";

/** A situação é buscada ao mostrar e guardada por 1 minuto. */
const CARD_STALE_MS = 60_000;

const STATUS_LABEL: Record<Exclude<InviteCardStatus, "pending">, string> = {
	not_found: "Esse código não existe",
	expired: "Venceu",
	used: "Já foi usado",
	revoked: "Cancelado",
};

function useInviteCard(code: string) {
	return useQuery({
		queryKey: ["invites", "card", code],
		queryFn: () => getInviteCard(code),
		staleTime: CARD_STALE_MS,
	});
}

/** O texto principal: quem convidou, ou de quem é a conta. */
function headline(invite: InviteLink, card: InviteCardView | undefined): string {
	const person = card?.person;
	const name = person ? (person.display_name ?? person.nick) : null;
	const kind = card?.kind ?? invite.kind;
	if (kind === "recovery") {
		return name
			? `Trocar de computador · conta de ${name}`
			: "Trocar de computador";
	}
	return name ? `Convite de ${name} para o Ashtar` : "Convite para o Ashtar";
}

function InviteCard({ invite, url }: { invite: InviteLink; url: string }) {
	const { data: card, isPending, isError } = useInviteCard(invite.code);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);

	const valid = card?.status === "pending";
	const gone = card !== undefined && !valid;
	const detail = isPending
		? "Conferindo o convite…"
		: isError
			? "Não deu para conferir o convite agora."
			: card.status === "pending"
				? card.expires_at
					? `Vale até ${formatValidUntil(card.expires_at)}`
					: "Vale"
				: STATUS_LABEL[card.status];

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	return (
		<article
			aria-label={headline(invite, card)}
			className={cn(
				"flex w-[min(100%,432px)] items-center gap-3 rounded-lg border-l-4 bg-card py-3 pr-3 pl-3.5",
				gone ? "border-l-border-strong" : "border-l-primary",
			)}
		>
			<img
				src={logo}
				alt=""
				className={cn("size-10 shrink-0 rounded-lg", gone && "opacity-50 grayscale")}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					className={cn(
						"truncate text-[15px] leading-snug font-semibold",
						gone ? "text-muted-foreground" : "text-foreground",
					)}
				>
					{headline(invite, card)}
				</span>
				<span
					className={cn(
						"truncate text-xs",
						gone ? "text-muted-foreground" : "text-secondary-foreground",
					)}
				>
					{detail}
				</span>
			</div>
			<button
				type="button"
				onClick={() => void copy()}
				className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent hover:text-foreground"
			>
				{copied ? (
					<CheckIcon aria-hidden="true" className="size-3.5" />
				) : (
					<CopyIcon aria-hidden="true" className="size-3.5" />
				)}
				{copied ? "Copiado" : "Copiar link"}
			</button>
		</article>
	);
}

/** Os cartões dos convites que aparecem no texto da mensagem. */
export function InviteCards({ body }: { body: string }) {
	const invites = inviteLinksIn(body);
	if (invites.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5 pt-1">
			{invites.map(({ invite, url }) => (
				<InviteCard key={invite.code} invite={invite} url={url} />
			))}
		</div>
	);
}

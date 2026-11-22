import type { ReactNode } from "react";
import { PopoverContent } from "@/components/ui/popover";
import { Avatar, nickColor, StatusDot } from "@/features/identity";
import type { Shown } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * O cartão que abre ao clicar numa pessoa, na lista de membros e na lista da sala (ADR 0020). É um
 * só para os dois lugares e cresce para baixo: o cabeçalho é fixo, e cada ação é uma seção que
 * quem abre o cartão passa como filho (o volume, na v0.3.0; Mensagem e Ligar, depois).
 *
 * No cabeçalho, o nome visível em cima e o nick embaixo, porque nomes podem se repetir e o nick
 * não. A faixa do topo sai da cor do nick.
 */

export interface UserCardPerson {
	nick: string;
	/** O nome visível, ou o nick de quem não tem um. */
	name: string;
	online: boolean;
	/** O que os outros veem de quem está online: Ocupado (a bolinha vermelha) ou Ausente (a lua). */
	status?: Shown;
	/** A sala de voz em que a pessoa está, e se transmite nela. `null` fora de sala. */
	room: { name: string; sharing: boolean } | null;
}

/** "Na Sala", "Na Sala · transmitindo", "Online", "Ausente", "Ocupado" ou "Offline". */
export function whereLabel(
	person: Pick<UserCardPerson, "online" | "status" | "room">,
) {
	if (person.room) {
		return person.room.sharing
			? `Em ${person.room.name} · transmitindo`
			: `Em ${person.room.name}`;
	}
	if (!person.online) return "Offline";
	if (person.status === "busy") return "Ocupado";
	return person.status === "away" ? "Ausente" : "Online";
}

export function UserCard({
	person,
	children,
}: {
	person: UserCardPerson;
	/** As seções, uma embaixo da outra. Sem filhos, o cartão é só o cabeçalho. */
	children?: ReactNode;
}) {
	const sharing = person.room?.sharing === true;
	return (
		<div className="flex flex-col">
			<div
				aria-hidden="true"
				className="h-14"
				style={{
					backgroundImage: `linear-gradient(135deg, ${nickColor(person.nick)}, var(--color-card))`,
				}}
			/>
			<div className="flex flex-col gap-3 px-4 pb-4">
				<Avatar
					nick={person.nick}
					displayName={person.name}
					size={60}
					className="-mt-[34px] border-4 border-card"
					badge={
						person.online && (
							<StatusDot
								status={person.status ?? "available"}
								className="size-4 border-[3px]"
							/>
						)
					}
				/>
				<div className="flex flex-col gap-0.5">
					<span className="truncate text-lg font-bold text-foreground">
						{person.name}
					</span>
					<span className="truncate text-[13px] text-muted-foreground">
						{person.nick}
					</span>
					<span
						className={cn(
							"truncate pt-1 text-[13px]",
							sharing ? "text-gold-text" : "text-muted-foreground",
						)}
					>
						{whereLabel(person)}
					</span>
				</div>
				{children}
			</div>
		</div>
	);
}

/**
 * O cartão dentro do popover: é o `PopoverContent` de quem abre, que fica com o `Popover` e com o
 * gatilho (a linha da pessoa). `side` é o lado em que o cartão aparece: à esquerda da lista de
 * membros, à direita da lista da sala.
 */
export function UserCardPopup({
	person,
	side,
	children,
}: {
	person: UserCardPerson;
	side: "left" | "right";
	children?: ReactNode;
}) {
	return (
		<PopoverContent
			side={side}
			align="start"
			sideOffset={side === "right" ? 16 : 12}
			aria-label={`Perfil de ${person.name}`}
			className="w-[280px] gap-0 overflow-hidden border-border-strong bg-card p-0"
		>
			<UserCard person={person}>{children}</UserCard>
		</PopoverContent>
	);
}

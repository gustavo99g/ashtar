import { CrownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, PersonName } from "@/features/identity";
import { SALA, useVoiceParticipants } from "@/features/voice";
import type { Person } from "@/lib/api";
import { cn } from "@/lib/utils";
import { authorName } from "../model/messages";
import { usePeople } from "../queries";

/**
 * A coluna de membros do chat, como no quadro "Canal de texto": "Membros — N" no alto, depois
 * três grupos, cada um em ordem de nome: o Dono (com a coroa), sempre no topo, esteja online ou
 * não; o Resto, que é quem mais está online; e o Offline, com quem está fora. Quem está online tem
 * a bolinha verde no avatar; quem está offline fica com o avatar e o nome apagados (`OFFLINE_DIM`),
 * mas com as mesmas cores, o dono inclusive. Embaixo
 * do nome, "Na Sala" ou "Transmitindo na Sala" para quem está na sala de voz (a mesma lista da
 * Etapa 5, que chega pelo tempo real).
 */
export function PeopleColumn() {
	const { data: people } = usePeople();
	const { data: inRoom } = useVoiceParticipants(SALA.id);
	if (!people) return <aside className={COLUMN} />;

	const room = new Map(inRoom?.map((p) => [p.user_id, p.screen_sharing]));
	const byName = (a: Person, b: Person) =>
		authorName(a).localeCompare(authorName(b), "pt-BR");
	const owner = people.filter((p) => p.is_owner).sort(byName);
	const rest = people.filter((p) => !p.is_owner && p.online).sort(byName);
	const offline = people.filter((p) => !p.is_owner && !p.online).sort(byName);

	return (
		<aside aria-label="Membros" className={COLUMN}>
			<div className="flex h-12 shrink-0 items-center border-b border-border px-4 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				Membros — {people.length}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
				<Group
					title="Dono"
					icon={<CrownIcon aria-hidden="true" className="size-3 text-gold" />}
					countless
					people={owner}
					room={room}
				/>
				<Group title="Resto" people={rest} room={room} />
				<Group title="Offline" people={offline} room={room} />
			</div>
		</aside>
	);
}

/** Quanto o offline apaga a linha (o avatar e o nome juntos): as cores de cada um continuam. */
const OFFLINE_DIM = "opacity-50";

const COLUMN = "flex w-60 shrink-0 flex-col border-l border-border bg-card";

function Group({
	title,
	icon,
	countless = false,
	people,
	room,
}: {
	title: string;
	/** Um ícone antes do título (a coroa do Dono). */
	icon?: ReactNode;
	/** Sem o "— N" depois do título: o grupo do Dono é de uma pessoa só. */
	countless?: boolean;
	people: Person[];
	room: Map<string, boolean>;
}) {
	if (people.length === 0) return null;
	return (
		<section aria-label={title} className="flex flex-col gap-0.5">
			<h3 className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				{icon}
				{countless ? title : `${title} — ${people.length}`}
			</h3>
			<ul className="flex flex-col gap-0.5">
				{people.map((person) => {
					const sharing = room.get(person.id);
					const online = person.online;
					return (
						<li
							key={person.id}
							className={cn(
								"flex items-center gap-2.5 rounded-md px-2 py-1.5",
								!online && OFFLINE_DIM,
							)}
						>
							<Avatar
								nick={person.nick}
								displayName={person.display_name}
								size={32}
								badge={
									online && (
										<span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-status-online" />
									)
								}
							/>
							<span className="flex min-w-0 flex-col">
								<PersonName
									owner={person.is_owner}
									className="truncate text-sm font-medium"
								>
									{authorName(person)}
								</PersonName>
								{sharing !== undefined && (
									<span className="truncate text-xs text-muted-foreground">
										{sharing ? "Transmitindo na Sala" : "Na Sala"}
									</span>
								)}
							</span>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

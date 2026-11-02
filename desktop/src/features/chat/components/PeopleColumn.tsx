import { Avatar, PersonName } from "@/features/identity";
import { SALA, useVoiceParticipants } from "@/features/voice";
import type { Person } from "@/lib/api";
import { cn } from "@/lib/utils";
import { authorName } from "../model/messages";
import { usePeople } from "../queries";

/**
 * A coluna de membros do chat: Online e Offline, cada grupo em ordem de nome. Embaixo do nome,
 * "Na Sala" ou "Transmitindo" para quem está na sala de voz (a mesma lista da Etapa 5, que chega
 * pelo tempo real).
 */
export function PeopleColumn() {
	const { data: people } = usePeople();
	const { data: inRoom } = useVoiceParticipants(SALA.id);
	if (!people) return <aside className="w-60 shrink-0 bg-card" />;

	const room = new Map(inRoom?.map((p) => [p.user_id, p.screen_sharing]));
	const byName = (a: Person, b: Person) =>
		authorName(a).localeCompare(authorName(b), "pt-BR");
	const online = people.filter((p) => p.online).sort(byName);
	const offline = people.filter((p) => !p.online).sort(byName);

	return (
		<aside
			aria-label="Membros"
			className="w-60 shrink-0 overflow-y-auto bg-card px-2 pb-4"
		>
			<Group title="Online" people={online} room={room} />
			<Group title="Offline" people={offline} room={room} dim />
		</aside>
	);
}

function Group({
	title,
	people,
	room,
	dim = false,
}: {
	title: string;
	people: Person[];
	room: Map<string, boolean>;
	dim?: boolean;
}) {
	if (people.length === 0) return null;
	return (
		<section aria-label={title}>
			<h3 className="px-2 pt-6 pb-1 text-xs font-bold tracking-[0.02em] text-muted-foreground uppercase">
				{title} — {people.length}
			</h3>
			<ul>
				{people.map((person) => {
					const sharing = room.get(person.id);
					return (
						<li
							key={person.id}
							className={cn(
								"flex items-center gap-3 rounded-md px-2 py-1.5",
								dim && "opacity-40",
							)}
						>
							<Avatar
								nick={person.nick}
								displayName={person.display_name}
								size={32}
							/>
							<span className="flex min-w-0 flex-col">
								<PersonName
									owner={person.is_owner}
									className="truncate text-sm"
								>
									{authorName(person)}
								</PersonName>
								{sharing !== undefined && (
									<span className="truncate text-xs text-muted-foreground">
										{sharing ? "Transmitindo" : "Na Sala"}
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

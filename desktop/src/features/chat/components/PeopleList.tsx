import { CrownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
	Avatar,
	PersonName,
	StatusDot,
	useSession,
} from "@/features/identity";
import { UserCardPopup } from "@/features/members";
import {
	SALA,
	UserVolume,
	useVoiceChannelId,
	useVoiceParticipants,
} from "@/features/voice";
import type { Person } from "@/lib/api";
import { cn } from "@/lib/utils";
import { authorName } from "../model/messages";
import { usePeople } from "../queries";

/**
 * A lista de membros, que é a aba Membros da lateral (`features/side-panel`): três grupos, cada um
 * em ordem de nome. O Dono (com a coroa), sempre no topo, esteja online ou não; o Resto, que é quem
 * mais está online; e o Offline, com quem está fora. Quem está online tem a bolinha verde no
 * avatar; quem está offline fica com o avatar e o nome apagados (`OFFLINE_DIM`), mas com as mesmas
 * cores, o dono inclusive. Embaixo do nome, "Na Sala" ou "Transmitindo na Sala" para quem está na
 * sala de voz (a mesma lista da Etapa 5 da v0.2.3, que chega pelo tempo real).
 *
 * Cada linha é um botão que abre o cartão da pessoa (`UserCardPopup`, ADR 0020), à esquerda da
 * lateral. É o mesmo cartão da lista da sala.
 *
 * `actions` são as seções a mais do cartão de cada pessoa (o botão Mensagem), postas por quem monta
 * a lista: o chat não conhece as conversas privadas, que são outra feature. Recebe a pessoa e uma
 * função que fecha o cartão.
 *
 * Até a v0.3.0 isto era a `PeopleColumn`, uma coluna dentro do `ChatView`. A lista não sabe mais
 * de largura, borda nem cabeçalho: quem a põe na tela é a lateral.
 */
export function PeopleList({ actions }: { actions?: PersonActions }) {
	const { data: people } = usePeople();
	const { data: inRoom } = useVoiceParticipants(SALA.id);
	if (!people) return null;

	const room = new Map(inRoom?.map((p) => [p.user_id, p.screen_sharing]));
	const byName = (a: Person, b: Person) =>
		authorName(a).localeCompare(authorName(b), "pt-BR");
	const owner = people.filter((p) => p.is_owner).sort(byName);
	const rest = people.filter((p) => !p.is_owner && p.online).sort(byName);
	const offline = people.filter((p) => !p.is_owner && !p.online).sort(byName);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
			<Group
				title="Dono"
				icon={<CrownIcon aria-hidden="true" className="size-3 text-gold" />}
				countless
				people={owner}
				room={room}
				actions={actions}
			/>
			<Group title="Resto" people={rest} room={room} actions={actions} />
			<Group title="Offline" people={offline} room={room} actions={actions} />
		</div>
	);
}

/** As seções a mais do cartão de `person`; `close` fecha o cartão. */
export type PersonActions = (person: Person, close: () => void) => ReactNode;

/** Quanto o offline apaga a linha (o avatar e o nome juntos): as cores de cada um continuam. */
const OFFLINE_DIM = "opacity-50";

function Group({
	title,
	icon,
	countless = false,
	people,
	room,
	actions,
}: {
	title: string;
	/** Um ícone antes do título (a coroa do Dono). */
	icon?: ReactNode;
	/** Sem o "— N" depois do título: o grupo do Dono é de uma pessoa só. */
	countless?: boolean;
	people: Person[];
	room: Map<string, boolean>;
	actions?: PersonActions;
}) {
	const session = useSession();
	const myId = session.status === "connected" ? session.user.id : null;
	const inSala = useVoiceChannelId() === SALA.id;
	if (people.length === 0) return null;
	return (
		<section aria-label={title} className="flex flex-col gap-0.5">
			<h3 className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				{icon}
				{countless ? title : `${title} — ${people.length}`}
			</h3>
			<ul className="flex flex-col gap-0.5">
				{people.map((person) => (
					<PersonRow
						key={person.id}
						person={person}
						sharing={room.get(person.id)}
						showVolume={inSala && person.id !== myId}
						actions={person.id !== myId ? actions : undefined}
					/>
				))}
			</ul>
		</section>
	);
}

/** Uma pessoa da lista: a linha, que é o botão, e o cartão que ela abre. */
function PersonRow({
	person,
	sharing,
	showVolume,
	actions,
}: {
	person: Person;
	/** Se transmite na sala; `undefined` para quem não está nela. */
	sharing: boolean | undefined;
	/** Você está na sala e esta pessoa não é você: o volume dela aparece se ela também está. */
	showVolume: boolean;
	actions?: PersonActions;
}) {
	// Controlado, para uma ação do cartão (abrir a conversa) poder fechá-lo.
	const [open, setOpen] = useState(false);
	const online = person.online;
	return (
		<li>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					className={cn(
						"flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
						"hover:bg-secondary data-popup-open:bg-secondary",
						!online && OFFLINE_DIM,
					)}
				>
					<Avatar
						nick={person.nick}
						displayName={person.display_name}
						size={32}
						badge={
							online && (
								<StatusDot status={person.status} className="size-2.5" />
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
								{sharing ? `Transmitindo na ${SALA.name}` : `Na ${SALA.name}`}
							</span>
						)}
					</span>
				</PopoverTrigger>
				<UserCardPopup
					side="left"
					person={{
						nick: person.nick,
						name: authorName(person),
						online,
						busy: person.status === "busy",
						room: sharing === undefined ? null : { name: SALA.name, sharing },
					}}
				>
					{actions?.(person, () => setOpen(false))}
					{/* O volume, só de quem está na mesma sala que você. */}
					{showVolume && sharing !== undefined && (
						<UserVolume userId={person.id} name={authorName(person)} />
					)}
				</UserCardPopup>
			</Popover>
		</li>
	);
}

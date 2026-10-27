import { PlayIcon, Volume2Icon } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, OfflineState } from "@/components/ui/states";
import { Avatar } from "@/features/identity";
import { isApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { SALA } from "../channel";
import { type ChannelMember, memberFromApi, peopleNowLabel } from "../members";
import { useVoiceParticipants } from "../queries";
import { watchShare } from "../roomView";
import { useVoice } from "../useVoice";
import { LiveBadge } from "./LiveBadge";
import { Starfield } from "./Starfield";

/*
 * A tela do servidor: a sala de voz antes de entrar. Quem está lá vem da API, de 5 em 5 segundos
 * com o app à vista. Sem chat ainda (0.2.4), o meio é a sala. Quem já está na chamada vai direto
 * para ela.
 */
export function ServerView() {
	const navigate = useNavigate();
	const { voiceChannelId, join } = useVoice();
	const inCall = voiceChannelId === SALA.id;
	const query = useVoiceParticipants(SALA.id, { enabled: !inCall });

	if (inCall) {
		return <Navigate to={paths.voiceRoom} replace />;
	}

	/** Entra na sala; com `watch`, a sala já abre assistindo a transmissão dessa pessoa. */
	function enter(watch?: string) {
		join(SALA.id);
		if (watch) watchShare(watch);
		void navigate(paths.voiceRoom);
	}

	const members = query.data?.map(memberFromApi);

	return (
		<div className="flex h-full flex-col">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
				<Volume2Icon
					aria-hidden="true"
					className="size-[18px] text-muted-foreground"
				/>
				<h1 className="text-[15px] font-bold text-foreground">{SALA.name}</h1>
			</header>
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<Starfield />
				<div className="absolute inset-0 flex flex-col items-center justify-center-safe overflow-y-auto p-6 text-center">
					{members === undefined ? (
						query.isError ? (
							<div className="flex flex-col items-center gap-5">
								{isApiError(query.error, "network") ? (
									<OfflineState onRetry={() => void query.refetch()} />
								) : (
									<ErrorState onRetry={() => void query.refetch()} />
								)}
								<EnterButton onClick={() => enter()} />
							</div>
						) : (
							<LoadingState />
						)
					) : members.length === 0 ? (
						<EmptyRoom onEnter={() => enter()} />
					) : (
						<PeopleInRoom members={members} onEnter={enter} />
					)}
				</div>
			</div>
		</div>
	);
}

function EnterButton({ onClick }: { onClick: () => void }) {
	return (
		<Button size="lg" className="w-60" onClick={onClick}>
			<Volume2Icon className="size-[18px]" />
			Entrar na sala
		</Button>
	);
}

function RoomHeading({ children }: { children: string }) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
				Sala de voz
			</span>
			<h2 className="text-[26px] font-bold text-foreground">{children}</h2>
		</div>
	);
}

function EmptyRoom({ onEnter }: { onEnter: () => void }) {
	return (
		<div className="flex flex-col items-center gap-5">
			<span className="flex size-20 items-center justify-center rounded-full border border-border-strong bg-secondary text-link">
				<Volume2Icon
					aria-hidden="true"
					className="size-[34px]"
					strokeWidth={1.75}
				/>
			</span>
			<RoomHeading>{`A ${SALA.name} está vazia`}</RoomHeading>
			<EnterButton onClick={onEnter} />
		</div>
	);
}

function PeopleInRoom({
	members,
	onEnter,
}: {
	members: ChannelMember[];
	onEnter: (watch?: string) => void;
}) {
	return (
		<div className="flex flex-col items-center gap-7">
			<RoomHeading>{peopleNowLabel(members.length, SALA.name)}</RoomHeading>
			<ul
				aria-label="Quem está na sala"
				className="flex max-w-[868px] flex-wrap justify-center gap-3"
			>
				{members.map((member) => (
					<li
						key={member.id}
						className="relative flex h-[168px] w-40 flex-col items-center justify-center gap-2.5 rounded-[10px] border border-border bg-card pt-[18px]"
					>
						{member.sharing && <LiveBadge className="absolute top-2 left-2" />}
						<Avatar nick={member.nick} displayName={member.name} size={52} />
						<span className="flex max-w-full flex-col gap-0.5 px-3">
							<span className="truncate text-[13px] font-semibold text-foreground">
								{member.name}
							</span>
							{member.nick !== member.name && (
								<span className="truncate text-xs text-muted-foreground">
									{member.nick}
								</span>
							)}
						</span>
						{member.sharing && (
							<Button
								variant="outline"
								size="sm"
								aria-label="Entrar na sala e assistir a transmissão"
								className="h-7 gap-1.5 border-ring px-3 text-link hover:text-link-hover"
								onClick={() => onEnter(member.id)}
							>
								<PlayIcon className="size-3 fill-current" />
								Assistir
							</Button>
						)}
					</li>
				))}
			</ul>
			<EnterButton onClick={() => onEnter()} />
		</div>
	);
}

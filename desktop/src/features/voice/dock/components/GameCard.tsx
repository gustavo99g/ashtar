import {
	EllipsisVerticalIcon,
	EyeOffIcon,
	Gamepad2Icon,
	MonitorUpIcon,
	SettingsIcon,
	Volume2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { playTime, useCurrentGame } from "@/features/activity";
import { allChannels, useOptionalChannelLayout } from "@/features/channels";
import {
	type ScreenShareController,
	shareProcessWindow,
	useNow,
	useScreenShareState,
} from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { type GameView, setGameHidden } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { useRoomOccupancy } from "../../members/hooks/useRoomOccupancy";
import { useVoice } from "../../room/hooks/useVoice";
import { useFollowGameWindow } from "../hooks/useFollowGameWindow";

/*
 * O cartão do jogo aberto (ADR 0033, decisões 5 a 8), em cima do "Voz conectada": o ícone,
 * "Jogando agora", o nome, há quanto tempo e o Transmitir. Só a própria pessoa vê.
 *
 * - Numa sala ou numa ligação, o Transmitir começa a transmissão da janela do jogo na hora (ou
 *   troca a fonte, se já estiver transmitindo outra coisa).
 * - Fora da voz, abre as salas para cima; a escolhida entra e a transmissão começa quando a voz
 *   conecta (o `pendingGameShare`).
 * - Transmitindo o próprio jogo, o botão some e o nome ganha a bolinha dourada.
 * - Transmitindo uma janela do jogo, quando outro processo dele vira o jogo do cartão (o cliente e
 *   a partida do League of Legends), a transmissão vai junto (`useFollowGameWindow`).
 */

/** O processo do jogo que vai ser transmitido quando a voz conectar. */
export const usePendingGameShare = create<{ pid: number | null }>()(() => ({
	pid: null,
}));

function failed(description: string): void {
	toast.add({
		title: "Não deu para transmitir o jogo",
		description,
		data: { tone: "error" },
	});
}

/** Transmite a janela do jogo; um erro vira o aviso do canto. */
async function shareGame(
	controller: ScreenShareController,
	game: GameView,
): Promise<void> {
	try {
		const found = await shareProcessWindow(controller, game.pid);
		if (!found) failed(`A janela de ${game.name} não está na lista de janelas.`);
	} catch (error) {
		failed(
			typeof error === "object" && error !== null && "message" in error
				? String(error.message)
				: "Tente de novo pelo botão Tela.",
		);
	}
}

export function GameCard() {
	const game = useCurrentGame();
	const { room, voiceChannelId, screenShare } = useVoice();
	const share = useScreenShareState(screenShare);
	const pending = usePendingGameShare((state) => state.pid);
	const now = useNow(30_000);
	useFollowGameWindow(screenShare, share, game);

	// A voz conectou depois do Transmitir de fora dela: começa agora.
	useEffect(() => {
		if (pending === null || !room || !screenShare || !game) return;
		if (game.pid !== pending) {
			usePendingGameShare.setState({ pid: null });
			return;
		}
		usePendingGameShare.setState({ pid: null });
		void shareGame(screenShare, game);
	}, [pending, room, screenShare, game]);

	// Saiu da voz sem conectar (ou o jogo fechou): esquece o pedido.
	useEffect(() => {
		if (!voiceChannelId || !game) usePendingGameShare.setState({ pid: null });
	}, [voiceChannelId, game]);

	if (!game) return null;

	const sharingGame =
		share.status === "active" && share.source.processId === game.pid;
	const waiting = pending === game.pid || share.status === "starting";

	return (
		<div className="flex items-start gap-2.5 border-b border-border px-2.5 py-2.5">
			<GameIcon game={game} />
			<div className="flex min-w-0 flex-1 flex-col gap-px">
				<span className="text-[10px] leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase">
					Jogando agora
				</span>
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-[13px] font-semibold text-foreground">
						{game.name}
					</span>
					{sharingGame && (
						<span
							role="img"
							aria-label="Transmitindo"
							title="Transmitindo"
							className="size-2 shrink-0 animate-pulse rounded-full bg-gold"
						/>
					)}
				</span>
				<span className="text-[11px] text-muted-foreground">
					{playTime(game.startedMs, now)}
				</span>
				{!sharingGame &&
					(room && screenShare ? (
						<Button
							size="sm"
							disabled={waiting}
							className="mt-1.5 h-7 w-full bg-gold px-2.5 text-gold-foreground hover:bg-gold/90"
							onClick={() => void shareGame(screenShare, game)}
						>
							<MonitorUpIcon aria-hidden="true" />
							Transmitir
						</Button>
					) : (
						<RoomsButton game={game} waiting={waiting || !!voiceChannelId} />
					))}
			</div>
			<GameMenu game={game} />
		</div>
	);
}

function GameIcon({ game }: { game: GameView }) {
	if (game.icon) {
		return (
			<img
				src={game.icon}
				alt=""
				className="size-10 shrink-0 rounded-lg object-contain"
			/>
		);
	}
	return (
		<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary-hover text-muted-foreground">
			<Gamepad2Icon aria-hidden="true" className="size-5" />
		</span>
	);
}

/** Fora da voz: as salas para cima; a escolhida entra e transmite quando conectar. */
function RoomsButton({ game, waiting }: { game: GameView; waiting: boolean }) {
	const [open, setOpen] = useState(false);
	const { join } = useVoice();
	const layout = useOptionalChannelLayout();
	const occupancy = useRoomOccupancy();
	// A lista já vem só com as salas que a pessoa acessa: as restritas em que ela está e, para
	// quem gerencia os canais, todas (ADR 0028).
	const rooms = layout
		? allChannels(layout).filter((channel) => channel.kind === "voice")
		: [];
	const counts = new Map<string, number>();
	for (const place of occupancy.values()) {
		counts.set(place.roomId, (counts.get(place.roomId) ?? 0) + 1);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				disabled={waiting}
				className={cn(
					"mt-1.5 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-gold px-2.5 text-xs font-semibold text-gold-foreground hover:bg-gold/90",
					"disabled:pointer-events-none disabled:opacity-60",
				)}
			>
				<MonitorUpIcon aria-hidden="true" className="size-4" />
				Transmitir
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-60 gap-1 p-1.5">
				<span className="px-2 pt-1 pb-1.5 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
					Transmitir em
				</span>
				{rooms.length === 0 && (
					<span className="px-2 pb-2 text-xs text-muted-foreground">
						Nenhuma sala de voz disponível.
					</span>
				)}
				{rooms.map((room) => {
					const count = counts.get(room.id) ?? 0;
					return (
						<button
							key={room.id}
							type="button"
							className="group/room flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
							onClick={() => {
								usePendingGameShare.setState({ pid: game.pid });
								join(room.id);
								setOpen(false);
							}}
						>
							<Volume2Icon
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground group-hover/room:text-gold"
							/>
							<span className="min-w-0 flex-1 truncate">{room.name}</span>
							<span className="text-[11px] text-muted-foreground">
								{count === 0
									? "vazia"
									: count === 1
										? "1 pessoa"
										: `${count} pessoas`}
							</span>
						</button>
					);
				})}
			</PopoverContent>
		</Popover>
	);
}

function GameMenu({ game }: { game: GameView }) {
	const navigate = useNavigate();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Opções de ${game.name}`}
				className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary-hover hover:text-foreground"
			>
				<EllipsisVerticalIcon aria-hidden="true" className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="end" className="w-[230px]">
				<DropdownMenuItem
					onClick={() => void setGameHidden(game.id, true).catch(() => {})}
				>
					<EyeOffIcon className="size-[15px]" />
					Não mostrar para este jogo
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => navigate(paths.settings.activity)}>
					<SettingsIcon className="size-[15px]" />
					Configurações de atividade
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

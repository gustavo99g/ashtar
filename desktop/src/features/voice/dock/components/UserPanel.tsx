import {
	HeadphoneOffIcon,
	HeadphonesIcon,
	MicIcon,
	MicOffIcon,
	SettingsIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import {
	Avatar,
	StatusDot,
	statusLabel,
	useMe,
	useMyStatus,
	useSession,
} from "@/features/identity";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { ShieldBadge } from "../../members/components/MuteMark";
import { useVoice } from "../../room/hooks/useVoice";
import { StatusMenu } from "./StatusMenu";

/*
 * O cartão de quem está usando, no pé da coluna: avatar, nome, microfone, áudio e o botão das
 * configurações. Microfone e áudio valem também fora da chamada (a próxima entrada já começa
 * assim).
 *
 * O avatar e o nome abrem o menu de status (`StatusMenu`). A bolinha e o texto embaixo do nome
 * seguem o status; em Ocupado o texto fica vermelho, o lembrete de que nada vai tocar.
 */
export function UserPanel() {
	const session = useSession();
	const { data: me } = useMe();
	const {
		isMuted,
		isDeafened,
		serverMuted,
		serverDeafened,
		mute,
		unmute,
		deafen,
		undeafen,
	} = useVoice();
	const user =
		me?.user ?? (session.status === "connected" ? session.user : null);
	const name = user ? user.display_name?.trim() || user.nick : "";
	const status = useMyStatus();
	const who = user && (
		<>
			<Avatar
				nick={user.nick}
				displayName={user.display_name}
				size={36}
				badge={
					<StatusDot status={status} className="size-3.5 border-secondary" />
				}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-px whitespace-nowrap">
				<span className="truncate text-sm font-semibold text-gold">{name}</span>
				<span
					title={
						status === "busy" ? "Notificações e toque de ligação desligados" : undefined
					}
					className={cn(
						"text-xs",
						status === "busy" ? "text-destructive-text" : "text-muted-foreground",
					)}
				>
					{statusLabel(status)}
				</span>
			</span>
		</>
	);

	return (
		<div className="flex h-[69px] items-center gap-1 pr-1.5 pl-1.5">
			{user ? (
				<StatusMenu user={user} trigger={who} />
			) : (
				<div className="min-w-0 flex-1" />
			)}
			<div className="flex shrink-0">
				{/* Travado pela moderação (ADR 0034): vermelho com o escudo, e o clique não solta. */}
				<PanelButton
					aria-label={
						serverMuted
							? "Silenciado pela moderação"
							: isMuted
								? "Ativar microfone"
								: "Desativar microfone"
					}
					title={serverMuted ? "Silenciado pela moderação" : undefined}
					aria-pressed={isMuted}
					aria-disabled={serverMuted || undefined}
					onClick={() => {
						if (serverMuted) return;
						void (isMuted ? unmute() : mute());
					}}
				>
					{isMuted ? (
						<MicOffIcon className="text-destructive-border" />
					) : (
						<MicIcon />
					)}
					{serverMuted && <ShieldBadge />}
				</PanelButton>
				<PanelButton
					aria-label={
						serverDeafened
							? "Áudio desligado pela moderação"
							: isDeafened
								? "Ativar áudio"
								: "Desativar áudio"
					}
					title={serverDeafened ? "Áudio desligado pela moderação" : undefined}
					aria-pressed={isDeafened}
					aria-disabled={serverDeafened || undefined}
					onClick={() => {
						if (serverDeafened) return;
						void (isDeafened ? undeafen() : deafen());
					}}
				>
					{isDeafened ? (
						<HeadphoneOffIcon className="text-destructive-border" />
					) : (
						<HeadphonesIcon />
					)}
					{serverDeafened && <ShieldBadge />}
				</PanelButton>
				<Link
					to={paths.settings.profile}
					aria-label="Configurações"
					className={panelButtonClass}
				>
					<SettingsIcon strokeWidth={1.8} />
				</Link>
			</div>
		</div>
	);
}

const panelButtonClass =
	"relative flex h-8 w-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-5";

function PanelButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn(panelButtonClass, className)}
			{...props}
		/>
	);
}

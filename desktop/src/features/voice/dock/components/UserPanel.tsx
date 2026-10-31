import {
	HeadphoneOffIcon,
	HeadphonesIcon,
	MicIcon,
	MicOffIcon,
	SettingsIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import { Avatar, useMe, useSession } from "@/features/identity";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { useVoice } from "../../room/hooks/useVoice";

/*
 * O cartão de quem está usando, no pé da coluna: avatar, nome, microfone, áudio e o botão das
 * configurações. Microfone e áudio valem também fora da chamada (a próxima entrada já começa
 * assim).
 */
export function UserPanel() {
	const session = useSession();
	const { data: me } = useMe();
	const { isMuted, isDeafened, mute, unmute, deafen, undeafen } = useVoice();
	const user =
		me?.user ?? (session.status === "connected" ? session.user : null);
	const name = user ? user.display_name?.trim() || user.nick : "";

	return (
		<div className="flex h-[69px] items-center gap-2 pr-1.5 pl-2.5">
			{user && (
				<Avatar
					nick={user.nick}
					displayName={user.display_name}
					size={36}
					badge={
						<span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-secondary bg-status-online" />
					}
				/>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-px whitespace-nowrap">
				<span className="truncate text-sm font-semibold text-gold">{name}</span>
				<span className="text-xs text-muted-foreground">Disponível</span>
			</div>
			<div className="flex shrink-0">
				<PanelButton
					aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
					aria-pressed={isMuted}
					onClick={() => void (isMuted ? unmute() : mute())}
				>
					{isMuted ? (
						<MicOffIcon className="text-destructive-border" />
					) : (
						<MicIcon />
					)}
				</PanelButton>
				<PanelButton
					aria-label={isDeafened ? "Ativar áudio" : "Desativar áudio"}
					aria-pressed={isDeafened}
					onClick={() => void (isDeafened ? undeafen() : deafen())}
				>
					{isDeafened ? (
						<HeadphoneOffIcon className="text-destructive-border" />
					) : (
						<HeadphonesIcon />
					)}
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
	"flex h-8 w-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-5";

function PanelButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn(panelButtonClass, className)}
			{...props}
		/>
	);
}

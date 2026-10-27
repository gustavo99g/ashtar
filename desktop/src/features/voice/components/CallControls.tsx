import {
	HeadphoneOffIcon,
	HeadphonesIcon,
	MicIcon,
	MicOffIcon,
	PhoneOffIcon,
	ScreenShareIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
	type ScreenShareController,
	useShareButton,
} from "@/features/screen-share";
import { cn } from "@/lib/utils";
import { useVoice } from "../useVoice";

/*
 * A barra de baixo da sala: Microfone, Áudio (o deafen), Tela e Sair. Sem o controller (ainda
 * conectando), o Tela fica desativado.
 */
export function CallControls({
	controller,
	onExit,
}: {
	controller: ScreenShareController | null;
	onExit: () => void;
}) {
	const { isMuted, isDeafened, mute, unmute, deafen, undeafen } = useVoice();

	return (
		<div className="flex h-[78px] shrink-0 items-center justify-center gap-2 border-t border-border bg-card">
			<BarButton
				label="Microfone"
				aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
				aria-pressed={isMuted}
				tone={isMuted ? "off" : "default"}
				onClick={() => void (isMuted ? unmute() : mute())}
			>
				{isMuted ? <MicOffIcon /> : <MicIcon />}
			</BarButton>
			<BarButton
				label="Áudio"
				aria-label={isDeafened ? "Ativar áudio" : "Desativar áudio"}
				aria-pressed={isDeafened}
				tone={isDeafened ? "off" : "default"}
				onClick={() => void (isDeafened ? undeafen() : deafen())}
			>
				{isDeafened ? <HeadphoneOffIcon /> : <HeadphonesIcon />}
			</BarButton>
			{controller ? (
				<ShareBarButton controller={controller} />
			) : (
				<BarButton label="Tela" disabled>
					<ScreenShareIcon />
				</BarButton>
			)}
			<span aria-hidden="true" className="mx-2 h-10 w-px bg-border" />
			<BarButton
				label="Sair"
				aria-label="Sair da sala"
				tone="exit"
				onClick={onExit}
			>
				<PhoneOffIcon className="size-[22px]!" />
			</BarButton>
		</div>
	);
}

function ShareBarButton({ controller }: { controller: ScreenShareController }) {
	const { active, disabled, onClick } = useShareButton(controller);
	return (
		<BarButton
			label="Tela"
			aria-label={active ? "Parar de transmitir a tela" : "Transmitir a tela"}
			aria-pressed={active}
			tone={active ? "on" : "default"}
			disabled={disabled}
			onClick={onClick}
		>
			<ScreenShareIcon />
		</BarButton>
	);
}

interface BarButtonProps extends Omit<ComponentProps<"button">, "children"> {
	label: string;
	tone?: "default" | "off" | "on" | "exit";
	children: ReactNode;
}

const circleTones = {
	default: "bg-secondary text-foreground group-hover:bg-secondary-hover",
	off: "bg-destructive-subtle text-destructive-border",
	on: "bg-primary text-primary-foreground group-hover:bg-primary-hover",
	exit: "bg-destructive text-destructive-foreground group-hover:bg-destructive-hover",
};

export function BarButton({
	label,
	tone = "default",
	className,
	children,
	...props
}: BarButtonProps) {
	return (
		<button
			type="button"
			className={cn(
				"group flex w-[76px] flex-col items-center gap-1 aria-disabled:cursor-not-allowed disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<span
				className={cn(
					"flex size-10 items-center justify-center rounded-full transition-colors [&_svg]:size-5",
					circleTones[tone],
				)}
			>
				{children}
			</span>
			<span
				className={cn(
					"text-xs",
					tone === "exit" ? "text-destructive-text" : "text-muted-foreground",
				)}
			>
				{label}
			</span>
		</button>
	);
}

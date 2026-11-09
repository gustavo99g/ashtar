import { PauseIcon, PlayIcon, ScreenShareIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarBadge } from "@/features/identity";
import {
	type ScreenShareController,
	ShareQuickSettings,
	useShareButton,
} from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { watchShare } from "../stores/roomViewStore";
import { BarButton, DockButton } from "./buttons";

/*
 * O botão Tela, na barra da sala (`bar`) e no painel "Voz conectada" (`dock`). Transmitindo, ele
 * vira Transmitindo (dourado, com a bolinha piscando) ou Pausada (sem piscar), e o clique abre os
 * ajustes rápidos da transmissão. Com outra pessoa transmitindo ele fica apagado, mas clicável: o
 * clique explica quem está transmitindo e oferece Assistir.
 */
export function ShareButton({
	controller,
	variant,
}: {
	controller: ScreenShareController;
	variant: "bar" | "dock";
}) {
	const navigate = useNavigate();
	const { active, paused, starting, busyWith, onClick } =
		useShareButton(controller);
	const [open, setOpen] = useState(false);
	const sharer = busyWith;

	const label = active
		? paused
			? "Transmissão pausada: ajustes"
			: "Transmitindo: ajustes"
		: sharer
			? `Tela: ${sharer.name} já está transmitindo`
			: "Transmitir a tela";
	const common = {
		"aria-label": label,
		"aria-disabled": sharer ? true : undefined,
		disabled: starting,
		onClick,
	};

	return (
		<Popover
			open={open && (sharer !== null || active)}
			onOpenChange={(next) => setOpen(next && (sharer !== null || active))}
		>
			<PopoverTrigger
				render={
					variant === "bar" ? (
						<BarButton
							label={active ? (paused ? "Pausada" : "Transmitindo") : "Tela"}
							tone={active ? (paused ? "paused" : "live") : "default"}
							{...common}
						>
							{active && paused ? <PauseIcon /> : <ScreenShareIcon />}
							{active && !paused && <LiveDot />}
						</BarButton>
					) : (
						<DockButton
							{...common}
							className={
								active
									? paused
										? "text-live ring-1 ring-live ring-inset"
										: "bg-live text-live-foreground hover:bg-live hover:brightness-110"
									: undefined
							}
						>
							{active && paused ? <PauseIcon /> : <ScreenShareIcon />}
							{active ? (paused ? "Pausada" : "Transmitindo") : "Tela"}
						</DockButton>
					)
				}
			/>
			{active && (
				<PopoverContent
					side="top"
					align={variant === "bar" ? "center" : "start"}
					sideOffset={10}
					className="w-[340px]"
				>
					<ShareQuickSettings
						controller={controller}
						onClose={() => setOpen(false)}
					/>
				</PopoverContent>
			)}
			{sharer && (
				<PopoverContent
					side="top"
					align={variant === "bar" ? "center" : "start"}
					sideOffset={10}
					className="w-80 gap-3.5"
				>
					<div className="flex gap-3">
						<Avatar
							nick={sharer.nick}
							displayName={sharer.name}
							size={36}
							badge={
								<AvatarBadge className="bg-popover">
									<ScreenShareIcon />
								</AvatarBadge>
							}
						/>
						<div className="flex flex-col gap-[3px]">
							<PopoverTitle className="text-sm">{`${sharer.name} já está transmitindo`}</PopoverTitle>
							<PopoverDescription className="text-xs leading-normal">
								Uma transmissão por vez. Quando a transmissão terminar, o botão
								Tela libera.
							</PopoverDescription>
						</div>
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
							OK
						</Button>
						<Button
							size="sm"
							onClick={() => {
								setOpen(false);
								watchShare(sharer.id);
								void navigate(paths.voiceRoom);
							}}
						>
							<PlayIcon className="size-3 fill-current" />
							Assistir
						</Button>
					</div>
				</PopoverContent>
			)}
		</Popover>
	);
}

/** A bolinha piscando do botão Transmitindo (parada com "reduzir movimento"). */
function LiveDot() {
	return (
		<span
			aria-hidden="true"
			className="absolute top-0.5 right-0.5 size-2 animate-pulse rounded-full bg-live ring-2 ring-background motion-reduce:animate-none"
		/>
	);
}

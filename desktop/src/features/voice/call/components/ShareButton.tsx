import { PlayIcon, ScreenShareIcon } from "lucide-react";
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
	useShareButton,
} from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { watchShare } from "../stores/roomViewStore";
import { BarButton, DockButton } from "./buttons";

/*
 * O botão Tela, na barra da sala (`bar`) e no painel "Voz conectada" (`dock`). Com outra pessoa
 * transmitindo ele fica apagado, mas clicável: o clique explica quem está transmitindo e oferece
 * Assistir.
 */
export function ShareButton({
	controller,
	variant,
}: {
	controller: ScreenShareController;
	variant: "bar" | "dock";
}) {
	const navigate = useNavigate();
	const { active, starting, busyWith, onClick } = useShareButton(controller);
	const [open, setOpen] = useState(false);
	const sharer = busyWith;

	const label = active
		? "Parar de transmitir a tela"
		: sharer
			? `Tela: ${sharer.name} já está transmitindo`
			: "Transmitir a tela";
	const common = {
		"aria-label": label,
		"aria-pressed": active,
		"aria-disabled": sharer ? true : undefined,
		disabled: starting,
		onClick,
	};

	return (
		<Popover
			open={open && sharer !== null}
			onOpenChange={(next) => setOpen(next && sharer !== null)}
		>
			<PopoverTrigger
				render={
					variant === "bar" ? (
						<BarButton
							label="Tela"
							tone={active ? "on" : "default"}
							{...common}
						>
							<ScreenShareIcon />
						</BarButton>
					) : (
						<DockButton
							{...common}
							className={
								active
									? "bg-primary text-primary-foreground hover:bg-primary-hover"
									: undefined
							}
						>
							<ScreenShareIcon />
							Tela
						</DockButton>
					)
				}
			/>
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

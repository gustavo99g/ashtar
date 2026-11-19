import { PauseIcon, ScreenShareIcon } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	type ScreenShareController,
	ShareQuickSettings,
	useShareButton,
} from "@/features/screen-share";
import { BarButton, DockButton } from "./buttons";

/*
 * O botão Tela, na barra da sala (`bar`) e no painel "Voz conectada" (`dock`). Transmitindo, ele
 * vira Transmitindo (dourado, com a bolinha piscando) ou Pausada (sem piscar), e o clique abre os
 * ajustes rápidos da transmissão. Outras pessoas transmitindo não travam o botão (ADR 0024); com a
 * sala no limite, a API recusa e o aviso diz por quê (`ShareNotices`).
 */
export function ShareButton({
	controller,
	variant,
}: {
	controller: ScreenShareController;
	variant: "bar" | "dock";
}) {
	const { active, paused, starting, onClick } = useShareButton(controller);
	const [open, setOpen] = useState(false);

	const label = active
		? paused
			? "Transmissão pausada: ajustes"
			: "Transmitindo: ajustes"
		: "Transmitir a tela";
	const common = {
		"aria-label": label,
		disabled: starting,
		onClick,
	};

	return (
		<Popover
			open={open && active}
			onOpenChange={(next) => setOpen(next && active)}
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

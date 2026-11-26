import { MusicIcon } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useOptionalMe } from "@/features/identity";
import type { Sound } from "@/lib/api";
import { BarButton, DockButton } from "../../call/components/buttons";
import { useVoice } from "../../room/hooks/useVoice";
import { useSoundsBlocked } from "../../room/stores/moderationStore";
import { requestPlay } from "../model/play";
import { SoundGrid } from "./SoundGrid";

const BLOCKED = "Um moderador bloqueou seus sons";

/**
 * O botão Sons (v0.9, ADR 0037), no painel de voz (`dock`) e na barra da chamada (`bar`), na sala
 * e na ligação: abre a grade. Quem teve os sons bloqueados numa sala do grupo vê o botão apagado,
 * com o motivo; na ligação privada a moderação não vale.
 */
export function SoundsButton({ variant }: { variant: "dock" | "bar" }) {
	const { room, voiceKind, isDeafened } = useVoice();
	const userId = useOptionalMe()?.user.id ?? null;
	const blockedInRoom = useSoundsBlocked(userId ?? undefined);
	const blocked = voiceKind !== "call" && blockedInRoom;
	const [open, setOpen] = useState(false);
	const disabled = !room;

	function play(sound: Sound) {
		void requestPlay(sound, { userId, deafened: isDeafened });
	}

	const common = {
		"aria-label": blocked ? BLOCKED : "Sons",
		"aria-disabled": blocked || undefined,
		title: blocked ? BLOCKED : undefined,
		disabled,
	};
	const trigger =
		variant === "bar" ? (
			<BarButton label="Sons" tone={open ? "on" : "default"} {...common}>
				<MusicIcon />
			</BarButton>
		) : (
			<DockButton {...common}>
				<MusicIcon />
				Sons
			</DockButton>
		);

	return (
		<Popover
			open={open && !blocked}
			onOpenChange={(next) => setOpen(next && !blocked)}
		>
			<PopoverTrigger render={trigger} />
			<PopoverContent
				side="top"
				align={variant === "bar" ? "center" : "start"}
				className="w-[340px] p-3"
			>
				<SoundGrid onPlay={play} />
			</PopoverContent>
		</Popover>
	);
}

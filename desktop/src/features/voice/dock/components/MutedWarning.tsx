import { MicOffIcon } from "lucide-react";
import { useMutedWarning } from "../../input/hooks/useMutedWarning";
import { useVoice } from "../../room/hooks/useVoice";

/** "Você está mutado", no alto do painel de voz (quadro "Voz — você está mutado"). */
export function MutedWarning() {
	const visible = useMutedWarning();
	const { unmute } = useVoice();
	if (!visible) return null;
	return (
		<div
			role="status"
			className="mx-2.5 mt-2.5 flex items-center gap-2.5 rounded-lg border border-destructive-border bg-destructive-subtle py-2 pr-2 pl-3"
		>
			<MicOffIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-destructive-text"
			/>
			<span className="grow text-[13px] font-semibold text-destructive-text">
				Você está mutado
			</span>
			<button
				type="button"
				onClick={() => void unmute()}
				className="h-[26px] rounded-md bg-destructive px-2.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive-hover"
			>
				Ativar
			</button>
		</div>
	);
}

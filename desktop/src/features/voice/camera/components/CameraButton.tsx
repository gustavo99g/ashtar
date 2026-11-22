import { ChevronUpIcon, VideoIcon, VideoOffIcon } from "lucide-react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { BarButton } from "../../call/components/buttons";
import { useVoice } from "../../room/hooks/useVoice";
import { setCameraOn } from "../hooks/useLocalCamera";
import { useCameraState } from "../stores/cameraStore";
import { CameraOptions } from "./CameraOptions";

/**
 * O botão Câmera da barra (entre Áudio e Tela), com a setinha que abre a prévia e os campos
 * (`CameraOptions`). Antes de conectar, fica desativado. Sempre começa desligado.
 */
export function CameraButton() {
	const { room } = useVoice();
	const on = useCameraState((state) => state.on);
	const busy = useCameraState((state) => state.busy);

	return (
		<div className="relative">
			<BarButton
				label="Câmera"
				aria-label={on ? "Desligar câmera" : "Ligar câmera"}
				aria-pressed={on}
				tone={on ? "on" : "default"}
				disabled={!room || busy}
				onClick={() => {
					if (room) void setCameraOn(room, !on);
				}}
			>
				{on ? <VideoIcon /> : <VideoOffIcon />}
			</BarButton>
			<Popover>
				<PopoverTrigger
					aria-label="Escolher câmera"
					className="absolute top-0 right-3 flex size-[18px] items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground data-popup-open:text-foreground [&_svg]:size-3"
				>
					<ChevronUpIcon aria-hidden="true" />
				</PopoverTrigger>
				<PopoverContent side="top" sideOffset={10} className="w-80">
					<CameraOptions />
				</PopoverContent>
			</Popover>
		</div>
	);
}

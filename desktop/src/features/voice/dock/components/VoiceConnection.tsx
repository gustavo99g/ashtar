import {
	PhoneOffIcon,
	ScreenShareIcon,
	SignalHighIcon,
	SignalLowIcon,
	SignalMediumIcon,
	TriangleAlertIcon,
	VideoIcon,
	WifiIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ConnectingState } from "@/components/ui/states";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { SALA } from "../../channel";
import { pingQuality } from "../model/ping";
import { stopWatching } from "../../roomView";
import { usePing } from "../hooks/usePing";
import { useVoice } from "../../useVoice";
import { DockButton } from "../../components/buttons";
import { ShareButton } from "../../components/ShareButton";

/*
 * O painel "Voz conectada" no pé da coluna, enquanto há chamada: Conectando ou Conectada (com o
 * ping), desconectar, a Câmera apagada (fora do roadmap da 0.2) e o Tela. Reconectando fica para a
 * 0.6: até lá, a volta da conexão aparece como Conectando.
 */
export function VoiceConnection() {
	const { room, connectionState, screenShare, leave } = useVoice();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	function disconnect() {
		leave();
		stopWatching();
		if (pathname === paths.voiceRoom)
			void navigate(paths.server, { replace: true });
	}

	return (
		<section
			aria-label="Conexão de voz"
			className="flex flex-col gap-2.5 border-b border-border py-2.5 pr-1.5 pl-2.5"
		>
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">
					{connectionState === "connected" ? (
						<Connected />
					) : connectionState === "error" ||
						connectionState === "disconnected" ? (
						<Failed />
					) : (
						<ConnectingState description={`${SALA.name} / Ashtar`} />
					)}
				</div>
				<button
					type="button"
					aria-label="Desconectar da sala"
					onClick={disconnect}
					className="flex size-[30px] shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-text"
				>
					<PhoneOffIcon className="size-[18px]" strokeWidth={1.75} />
				</button>
			</div>
			<div className="grid grid-cols-2 gap-1.5 pr-1">
				<DockButton
					aria-disabled="true"
					title="A câmera chega depois"
					className="cursor-not-allowed hover:bg-secondary-hover"
				>
					<VideoIcon />
					Câmera
				</DockButton>
				{room && screenShare ? (
					<ShareButton controller={screenShare} variant="dock" />
				) : (
					<DockButton disabled>
						<ScreenShareIcon />
						Tela
					</DockButton>
				)}
			</div>
		</section>
	);
}

function Connected() {
	const { room } = useVoice();
	const ping = usePing(room);
	const quality = ping === null ? null : pingQuality(ping);
	const SignalIcon =
		quality === "boa"
			? SignalHighIcon
			: quality === "média"
				? SignalMediumIcon
				: SignalLowIcon;

	return (
		<div className="flex items-center gap-2">
			<WifiIcon aria-hidden="true" className="size-[18px] shrink-0 text-ring" />
			<div className="flex min-w-0 flex-col whitespace-nowrap">
				<span className="text-[13px] font-semibold text-ring">
					Voz conectada
				</span>
				<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
					{SALA.name}
					{ping !== null && (
						<>
							<span aria-hidden="true">·</span>
							<span
								title={`Ping: ${ping} ms, conexão ${quality}`}
								className="flex items-center gap-1"
							>
								<SignalIcon
									aria-hidden="true"
									className={cn(
										"size-3",
										quality === "boa"
											? "text-status-online"
											: quality === "média"
												? "text-status-connecting"
												: "text-destructive-border",
									)}
								/>
								<span className="font-mono text-[11px]">{ping} ms</span>
							</span>
						</>
					)}
				</span>
			</div>
		</div>
	);
}

function Failed() {
	return (
		<div role="alert" className="flex items-center gap-2">
			<TriangleAlertIcon
				aria-hidden="true"
				className="size-[18px] shrink-0 text-destructive-text"
			/>
			<div className="flex min-w-0 flex-col whitespace-nowrap">
				<span className="text-[13px] font-semibold text-destructive-text">
					Sem conexão com a sala
				</span>
				<span className="text-xs text-muted-foreground">
					{SALA.name} / Ashtar
				</span>
			</div>
		</div>
	);
}

import {
	PhoneOffIcon,
	ScreenShareIcon,
	SignalHighIcon,
	SignalLowIcon,
	SignalMediumIcon,
	TriangleAlertIcon,
	VideoIcon,
	VideoOffIcon,
	WifiIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ConnectingState } from "@/components/ui/states";
import { ShortcutKeys, useShortcuts } from "@/features/settings";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { useConnectedRoomName } from "../../room/hooks/useRoomName";
import { pingQuality } from "../model/ping";
import { stopWatching } from "../../call/stores/roomViewStore";
import { usePing } from "../hooks/usePing";
import { useVoice } from "../../room/hooks/useVoice";
import { useInputChoice } from "../../input/stores/inputStore";
import { DockButton } from "../../call/components/buttons";
import { ShareButton } from "../../call/components/ShareButton";
import { setCameraOn } from "../../camera/hooks/useLocalCamera";
import { useCameraState } from "../../camera/stores/cameraStore";

/*
 * O painel "Voz conectada" no pé da coluna, enquanto há chamada: Conectando ou Conectada (com o
 * ping), desconectar, a Câmera (liga e desliga, como a da barra da sala) e o Tela. Desde a 0.6, Reconectando
 * enquanto a voz volta sozinha de uma queda (ADR 0030).
 *
 * Na ligação privada (ADR 0023), o painel diz "Em ligação", em azul, com quem, e o botão é o
 * Desligar. Desligar daqui é sair da sala da ligação, e a `features/calls` encerra para os dois.
 */
export function VoiceConnection() {
	const { room, connectionState, screenShare, leave, voiceKind, voiceTitle } =
		useVoice();
	const roomName = useConnectedRoomName();
	const place =
		voiceKind === "call" ? `Ligação com ${voiceTitle ?? ""}` : roomName;
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
						<Connected call={voiceKind === "call"} place={place} />
					) : connectionState === "error" ||
						connectionState === "disconnected" ? (
						<Failed call={voiceKind === "call"} place={place} />
					) : connectionState === "reconnecting" ? (
						<ConnectingState
							title="Reconectando…"
							description="Conexão perdida, tentando de novo"
						/>
					) : (
						<ConnectingState description={`${place} / Ashtar`} />
					)}
				</div>
				<button
					type="button"
					aria-label={
						voiceKind === "call" ? "Desligar a ligação" : "Desconectar da sala"
					}
					onClick={disconnect}
					className="flex size-[30px] shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-text"
				>
					<PhoneOffIcon className="size-[18px]" strokeWidth={1.75} />
				</button>
			</div>
			<div className="grid grid-cols-2 gap-1.5 pr-1">
				<DockCameraButton />
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

/** A Câmera do painel: o mesmo liga e desliga da barra da sala, sem a prévia. */
function DockCameraButton() {
	const { room } = useVoice();
	const on = useCameraState((state) => state.on);
	const busy = useCameraState((state) => state.busy);
	return (
		<DockButton
			aria-label={on ? "Desligar câmera" : "Ligar câmera"}
			aria-pressed={on}
			disabled={!room || busy}
			className={
				on
					? "bg-primary text-primary-foreground hover:bg-primary-hover"
					: undefined
			}
			onClick={() => {
				if (room) void setCameraOn(room, !on);
			}}
		>
			{on ? <VideoIcon /> : <VideoOffIcon />}
			Câmera
		</DockButton>
	);
}

function Connected({ call, place }: { call: boolean; place: string }) {
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
					{call ? "Em ligação" : "Voz conectada"}
				</span>
				<span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
					<span className="truncate">{place}</span>
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
				<PushToTalkHint />
			</div>
		</div>
	);
}

/** No modo Pressionar para falar, a tecla embaixo do nome da sala (quadro "Voz — você está mutado"). */
function PushToTalkHint() {
	const pushToTalk = useInputChoice((state) => state.mode === "ptt");
	const shortcut = useShortcuts((state) => state.ptt);
	if (!pushToTalk) return null;
	return (
		<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
			Pressionar para falar:
			{shortcut ? (
				<ShortcutKeys
					label={shortcut.label}
					className="[&_kbd]:px-[5px] [&_kbd]:py-0 [&_kbd]:text-[11px]"
				/>
			) : (
				<span className="text-warning-text">sem atalho</span>
			)}
		</span>
	);
}

function Failed({ call, place }: { call: boolean; place: string }) {
	return (
		<div role="alert" className="flex items-center gap-2">
			<TriangleAlertIcon
				aria-hidden="true"
				className="size-[18px] shrink-0 text-destructive-text"
			/>
			<div className="flex min-w-0 flex-col whitespace-nowrap">
				<span className="text-[13px] font-semibold text-destructive-text">
					{call ? "Sem conexão com a ligação" : "Sem conexão com a sala"}
				</span>
				<span className="text-xs text-muted-foreground">{place} / Ashtar</span>
			</div>
		</div>
	);
}

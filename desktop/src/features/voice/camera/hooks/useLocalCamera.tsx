import {
	type LocalTrackPublication,
	type Room,
	RoomEvent,
	Track,
	type TrackPublication,
	TrackEvent,
} from "livekit-client";
import { useEffect } from "react";
import { toast } from "@/components/ui/toast";
import { VideoOffIcon } from "lucide-react";
import { NoticeIcon } from "../../call/components/NoticeIcon";
import {
	type CameraDevice,
	type CameraQuality,
	cameraCapture,
	cameraPublish,
	effectiveCamera,
} from "../model/camera";
import { useCameraChoice } from "../stores/cameraChoiceStore";
import { useCameraState } from "../stores/cameraStore";
import { useCameras } from "./useCameras";

/*
 * A própria câmera na conexão de agora (ADR 0025). Liga e desliga pelo botão Câmera
 * (`setCameraOn`); desligar tira a trilha da sala (não só pausa), e a luz da câmera apaga.
 *
 * Sempre começa desligada: cada entrada (sala nova, troca de sala, ligação atendida) cria uma `Room`
 * nova, e sair dela para as trilhas. Trocar de câmera com ela ligada troca na hora; trocar a
 * qualidade publica de novo, com o teto novo. A câmera que some (desconectada) desliga com um aviso.
 */

function cameraPublication(room: Room): LocalTrackPublication | undefined {
	return room.localParticipant.getTrackPublication(Track.Source.Camera);
}

function isOn(room: Room): boolean {
	const publication = cameraPublication(room);
	return Boolean(publication?.track && !publication.isMuted);
}

function notice(title: string, description: string): void {
	toast.add({
		title,
		description,
		data: {
			media: (
				<NoticeIcon tone="warning">
					<VideoOffIcon />
				</NoticeIcon>
			),
		},
	});
}

/** O que a escolha de agora pede para abrir e publicar. */
function currentChoice(cameras: readonly CameraDevice[] | null) {
	const { device, quality } = useCameraChoice.getState();
	return { deviceId: effectiveCamera(device, cameras), quality };
}

/** A lista de agora, para o clique no botão ler sem depender do React. */
let knownCameras: readonly CameraDevice[] | null = null;

async function publish(room: Room, deviceId: string | null, quality: CameraQuality) {
	await room.localParticipant.setCameraEnabled(
		true,
		cameraCapture(deviceId, quality),
		cameraPublish(quality),
	);
}

async function unpublish(room: Room): Promise<void> {
	const track = cameraPublication(room)?.track;
	if (track) await room.localParticipant.unpublishTrack(track, true);
}

/** Liga ou desliga a própria câmera. Um erro (câmera ocupada, sem permissão) vira aviso. */
export async function setCameraOn(room: Room, on: boolean): Promise<void> {
	if (useCameraState.getState().busy) return;
	useCameraState.setState({ busy: true });
	try {
		if (on) {
			const { deviceId, quality } = currentChoice(knownCameras);
			await publish(room, deviceId, quality);
		} else {
			await unpublish(room);
		}
	} catch (error) {
		console.warn("Erro ao trocar o estado da câmera:", error);
		if (on) {
			await unpublish(room).catch(() => undefined);
			notice(
				"Não foi possível ligar a câmera",
				"Confira se outro programa está usando a câmera ou se o Windows bloqueou o acesso.",
			);
		}
	} finally {
		useCameraState.setState({ busy: false, on: isOn(room) });
	}
}

/** Liga os eventos da câmera à sala de agora. Fica no `VoiceProvider`. */
export function useLocalCamera(room: Room | null): void {
	const cameras = useCameras();
	knownCameras = cameras;
	const device = useCameraChoice((state) => state.device);
	const quality = useCameraChoice((state) => state.quality);
	const deviceId = effectiveCamera(device, cameras);

	// O estado do botão segue a sala; sem sala, desligada.
	useEffect(() => {
		useCameraState.setState({ on: room ? isOn(room) : false, busy: false });
		if (!room) return;
		const update = (publication?: TrackPublication) => {
			if (!publication || publication.source === Track.Source.Camera) {
				useCameraState.setState({ on: isOn(room) });
			}
		};
		// A câmera que some: o livekit-client tenta outra; aqui ela desliga, com o aviso.
		const onEnded = () => {
			void unpublish(room).finally(() =>
				useCameraState.setState({ on: isOn(room) }),
			);
			notice(
				"A câmera foi desconectada",
				"Ela desligou. Ligue de novo quando ela voltar, ou escolha outra.",
			);
		};
		const watchEnded = (publication: TrackPublication) => {
			if (publication.source !== Track.Source.Camera) return;
			publication.track?.once(TrackEvent.Ended, onEnded);
		};
		const onPublished = (publication: TrackPublication) => {
			watchEnded(publication);
			update(publication);
		};
		room.on(RoomEvent.LocalTrackPublished, onPublished);
		room.on(RoomEvent.LocalTrackUnpublished, update);
		room.on(RoomEvent.TrackMuted, update);
		room.on(RoomEvent.TrackUnmuted, update);
		return () => {
			room.off(RoomEvent.LocalTrackPublished, onPublished);
			room.off(RoomEvent.LocalTrackUnpublished, update);
			room.off(RoomEvent.TrackMuted, update);
			room.off(RoomEvent.TrackUnmuted, update);
			cameraPublication(room)?.track?.off(TrackEvent.Ended, onEnded);
		};
	}, [room]);

	// Com a câmera ligada, a câmera escolhida vale na hora.
	// Sem escolha, a primeira da lista (o WebView2 não tem um "default" para câmeras).
	const switchTo = deviceId ?? cameras?.[0]?.id ?? null;
	useEffect(() => {
		if (!room || !switchTo || !isOn(room)) return;
		void room
			.switchActiveDevice("videoinput", switchTo)
			.catch((error: unknown) =>
				console.warn("Não foi possível trocar de câmera:", error),
			);
	}, [room, switchTo]);

	// A qualidade nova muda o teto da publicação: publica de novo.
	useEffect(() => {
		if (!room || !isOn(room)) return;
		void (async () => {
			await setCameraOn(room, false);
			await setCameraOn(room, true);
		})();
		// Só a qualidade: a câmera troca pelo efeito de cima.
	}, [room, quality]);
}

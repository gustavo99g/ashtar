import { VideoOffIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useMaybeVoice } from "../../room/hooks/useMaybeVoice";
import { useCameraPreview } from "../hooks/useCameraPreview";
import { useCameras } from "../hooks/useCameras";
import {
	CAMERA_PRESETS,
	CAMERA_QUALITIES,
	type CameraQuality,
	effectiveCamera,
} from "../model/camera";
import {
	chooseCamera,
	chooseCameraQuality,
	setCameraMirror,
	useCameraChoice,
} from "../stores/cameraChoiceStore";
import { useCameraState } from "../stores/cameraStore";
import { CameraVideo, cameraTrackOf } from "./CameraVideo";

/*
 * A prévia e os campos da câmera (quadro "Webcam — escolher câmera"): o dispositivo, a qualidade
 * (480p, 720p, 1080p, a 30 fps) e Espelhar. Aparece na setinha do botão Câmera e em Configurações ›
 * Voz e vídeo. A prévia só a própria pessoa vê; com a câmera já ligada na sala, ela mostra a trilha
 * publicada, sem abrir a câmera de novo.
 */

const SYSTEM = "default";
const SYSTEM_NAME = "Padrão do Windows";

export function CameraOptions({ className }: { className?: string }) {
	const choice = useCameraChoice();
	const on = useCameraState((state) => state.on);
	const room = useMaybeVoice()?.room ?? null;
	const published = on && room ? cameraTrackOf(room.localParticipant) : null;

	// Abrir a câmera faz o WebView2 dizer os nomes: a lista é lida de novo depois.
	const [opened, setOpened] = useState(false);
	const cameras = useCameras(opened);
	const preview = useCameraPreview(
		!published,
		effectiveCamera(choice.device, cameras),
		choice.quality,
	);
	useEffect(() => {
		if (preview.status === "on") setOpened(true);
	}, [preview.status]);

	return (
		<div className={cn("flex flex-col gap-4", className)}>
			<div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-rail">
				{published ? (
					<CameraVideo trackRef={published} mirror={choice.mirror} />
				) : preview.status === "on" ? (
					<PreviewVideo stream={preview.stream} mirror={choice.mirror} />
				) : preview.status === "error" ? (
					<p className="flex flex-col items-center gap-2 px-6 text-center text-xs text-muted-foreground">
						<VideoOffIcon aria-hidden="true" className="size-5" />
						{preview.message}
					</p>
				) : (
					<Spinner className="size-5 text-primary" />
				)}
				<span className="absolute bottom-2 left-2 rounded-sm bg-rail/85 px-1.5 py-0.5 text-[11px] text-secondary-foreground">
					Só você vê esta prévia
				</span>
			</div>
			<CameraPicker cameras={cameras} />
			<div className="flex flex-col gap-2">
				<span className="text-xs font-semibold text-muted-foreground">
					Qualidade
				</span>
				<Segmented
					aria-label="Qualidade da câmera"
					value={choice.quality}
					onValueChange={(next) => chooseCameraQuality(next as CameraQuality)}
				>
					{CAMERA_QUALITIES.map((quality) => (
						<SegmentedItem key={quality} value={quality}>
							{CAMERA_PRESETS[quality].label}
						</SegmentedItem>
					))}
				</Segmented>
				<span className="text-xs text-muted-foreground">
					A 30 fps. Quem vê você num bloco pequeno recebe uma versão mais leve.
				</span>
			</div>
			<MirrorSwitch />
		</div>
	);
}

function PreviewVideo({
	stream,
	mirror,
}: {
	stream: MediaStream;
	mirror: boolean;
}) {
	const video = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (video.current) video.current.srcObject = stream;
	}, [stream]);
	return (
		<video
			ref={video}
			autoPlay
			muted
			playsInline
			aria-label="Prévia da câmera"
			className={cn("size-full object-cover", mirror && "-scale-x-100")}
		/>
	);
}

function CameraPicker({
	cameras,
}: {
	cameras: { id: string; label: string }[] | null;
}) {
	const chosen = useCameraChoice((state) => state.device);
	const list = cameras ?? [];
	const options = [
		{ value: SYSTEM, label: SYSTEM_NAME },
		...list.map((camera, index) => ({
			value: camera.id,
			label: camera.label || `Câmera ${index + 1}`,
		})),
	];
	const missing =
		chosen !== null && cameras !== null && !list.some((c) => c.id === chosen.id);
	if (chosen && !list.some((camera) => camera.id === chosen.id)) {
		options.push({
			value: chosen.id,
			label: `${chosen.label || "Câmera escolhida"}${missing ? " (desconectada)" : ""}`,
		});
	}

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<Select
				items={options}
				value={chosen?.id ?? SYSTEM}
				onValueChange={(value: string | null) => {
					if (value === null || value === SYSTEM) {
						chooseCamera(null);
						return;
					}
					const camera = list.find((item) => item.id === value);
					if (camera) chooseCamera(camera);
				}}
			>
				<SelectLabel>Câmera</SelectLabel>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value} label={option.label}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{missing && (
				<p className="text-xs text-warning-text">
					Desconectada. Até ela voltar, o Ashtar usa a câmera padrão do Windows.
				</p>
			)}
		</div>
	);
}

function MirrorSwitch() {
	const labelId = useId();
	const mirror = useCameraChoice((state) => state.mirror);
	return (
		<div className="flex items-center justify-between gap-6">
			<span className="flex flex-col gap-[3px]">
				<span id={labelId} className="text-sm font-medium text-foreground">
					Espelhar
				</span>
				<span className="text-xs text-muted-foreground">
					Só para você. Os outros veem a imagem como sai da câmera.
				</span>
			</span>
			<Switch
				checked={mirror}
				onCheckedChange={setCameraMirror}
				aria-labelledby={labelId}
				variant="blue"
			/>
		</div>
	);
}

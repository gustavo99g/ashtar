/**
 * O print da transmissão (decisões 22 a 24 do plano da v0.8), pelo atalho global.
 *
 * Qual: a transmissão em foco; sem foco, a única aberta (com várias, a última que a pessoa abriu);
 * sem assistir nenhuma, a própria, se estiver transmitindo. Sem nada disso, o atalho não faz nada.
 *
 * De onde: a de outra pessoa, do quadro que o `<video>` mostra agora, no tamanho em que chega; a
 * própria, do Rust, que pega a imagem da fonte no tamanho cheio. Os dois caminhos acabam no Rust,
 * que copia para a área de transferência e, se a pessoa quiser, salva em `Imagens\Ashtar`.
 */
import { FolderOpenIcon } from "lucide-react";
import { createElement } from "react";
import {
	type RemoteParticipant,
	type Room,
	Track,
	type VideoTrack,
} from "livekit-client";
import { toast } from "@/components/ui/toast";
import type { ScreenShareController } from "@/features/screen-share";
import { useSettingsStore } from "@/features/settings";
import {
	openScreenshotDir,
	type ScreenshotDone,
	screenshotImage,
	screenshotSource,
} from "@/lib/tauri/commands";
import { useRoomView } from "./stores/roomViewStore";

/** O sufixo da identidade da conexão da tela (`{id}:screen`, ADR 0017). */
const SCREEN = ":screen";

/** Quanto esperar o primeiro quadro de um `<video>` montado só para o print. */
const FRAME_WAIT_MS = 2000;

export type ScreenshotTarget =
	| { kind: "own" }
	| { kind: "remote"; ownerId: string };

/** Qual transmissão o atalho pega (ver o módulo). */
export function screenshotTarget(
	view: { focused: string | null; watching: readonly string[] },
	sharingOwn: boolean,
	me: string,
): ScreenshotTarget | null {
	const pick =
		view.focused ?? view.watching[view.watching.length - 1] ?? null;
	if (pick !== null && pick !== me) return { kind: "remote", ownerId: pick };
	if (sharingOwn) return { kind: "own" };
	return null;
}

/** `juju 2026-11-22 21-40`: o nome do arquivo, com a hora daqui. */
export function screenshotName(person: string, at = new Date()): string {
	const two = (n: number) => String(n).padStart(2, "0");
	const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
	return `${person} ${date} ${two(at.getHours())}-${two(at.getMinutes())}`;
}

function personName(room: Room, id: string): string {
	const participant: RemoteParticipant | undefined =
		room.remoteParticipants.get(id) ??
		room.remoteParticipants.get(`${id}${SCREEN}`);
	return participant?.name?.trim() || id;
}

/** O PNG (em data URL) do quadro de agora de um `<video>` que já tem imagem. */
function drawVideo(video: HTMLVideoElement): string | null {
	if (video.videoWidth === 0 || video.videoHeight === 0) return null;
	const canvas = document.createElement("canvas");
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(video, 0, 0);
	return canvas.toDataURL("image/png");
}

/** O quadro da tela `track`: do `<video>` da sala, ou de um montado só para isso. */
async function grabFrame(track: VideoTrack): Promise<string | null> {
	for (const element of track.attachedElements) {
		if (element instanceof HTMLVideoElement) {
			const png = drawVideo(element);
			if (png) return png;
		}
	}
	const video = document.createElement("video");
	video.muted = true;
	track.attach(video);
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("sem imagem")), FRAME_WAIT_MS);
			video.addEventListener(
				"loadeddata",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
			void video.play().catch(() => {});
		});
		return drawVideo(video);
	} catch {
		return null;
	} finally {
		track.detach(video);
	}
}

function failed(description: string): void {
	toast.add({
		title: "Não deu para tirar o print",
		description,
		data: { tone: "error" },
	});
}

function done(result: ScreenshotDone): void {
	const media = createElement("img", {
		src: result.thumbnail,
		alt: "",
		className: "h-9 w-16 shrink-0 rounded object-cover",
	});
	if (result.path) {
		toast.add({
			title: "Print salvo e copiado",
			data: { compact: true, media },
			actionProps: {
				children: createElement(
					"span",
					{ className: "inline-flex items-center gap-1" },
					createElement(FolderOpenIcon, { className: "size-3.5" }),
					"Abrir pasta",
				),
				onClick: () => void openScreenshotDir().catch(() => {}),
			},
		});
		return;
	}
	toast.add({ title: "Print copiado", data: { compact: true, media } });
}

/**
 * Tira o print (ver o módulo). Devolve se tirou: quem chama toca o som. Uma falha vira o aviso do
 * canto.
 */
export async function takeScreenshot(
	room: Room | null,
	controller: ScreenShareController | null,
): Promise<boolean> {
	if (!room) return false;
	const me = room.localParticipant.identity;
	const share = controller?.getState();
	const target = screenshotTarget(
		useRoomView.getState(),
		share?.status === "active",
		me,
	);
	if (!target) return false;
	const save = useSettingsStore.getState().saveScreenshots;

	try {
		if (target.kind === "own") {
			if (share?.status !== "active") return false;
			const name = room.localParticipant.name?.trim() || me;
			done(
				await screenshotSource(
					share.source.source,
					save ? screenshotName(name) : null,
				),
			);
			return true;
		}
		const publication = room.remoteParticipants
			.get(`${target.ownerId}${SCREEN}`)
			?.getTrackPublication(Track.Source.ScreenShare);
		const track = publication?.videoTrack;
		const png = track ? await grabFrame(track) : null;
		if (!png) {
			failed("A transmissão ainda não chegou. Tente de novo em instantes.");
			return false;
		}
		const name = personName(room, target.ownerId);
		done(await screenshotImage(png, save ? screenshotName(name) : null));
		return true;
	} catch (error) {
		failed(
			typeof error === "object" && error !== null && "message" in error
				? String(error.message)
				: "Tente de novo em instantes.",
		);
		return false;
	}
}

import {
	ScreenShareOffIcon,
	TriangleAlertIcon,
	VolumeXIcon,
} from "lucide-react";
import { useEffect } from "react";
import { toast } from "@/components/ui/toast";
import {
	openSourcePicker,
	restartShare,
	type ScreenShareController,
	type ShareNotice,
	shareNotice,
} from "@/features/screen-share";
import { NoticeIcon } from "./NoticeIcon";

/**
 * Os avisos do compartilhamento no canto: terminou (a fonte sumiu), o áudio parou e não deu para
 * compartilhar. Escuta o controller direto, para não perder uma mudança no meio de outra. Um aviso
 * novo, ou uma transmissão começando, fecha o anterior. Não desenha nada.
 */
export function ShareNotices({
	controller,
}: {
	controller: ScreenShareController;
}) {
	useEffect(() => {
		let previous = controller.getState();
		let shown: string | null = null;

		const unsubscribe = controller.onStateChange((next) => {
			const notice = shareNotice(previous, next);
			previous = next;
			if (!notice && next.status !== "starting") return;
			if (shown) toast.close(shown);
			shown = notice ? showNotice(notice, controller) : null;
		});

		return () => {
			unsubscribe();
		};
	}, [controller]);

	return null;
}

function showNotice(
	notice: ShareNotice,
	controller: ScreenShareController,
): string {
	switch (notice.kind) {
		case "ended": {
			const id = toast.add({
				title: "O compartilhamento terminou",
				description:
					notice.source.source.kind === "window"
						? "A janela compartilhada foi fechada."
						: "A tela compartilhada foi desconectada.",
				data: {
					media: (
						<NoticeIcon tone="info">
							<ScreenShareOffIcon />
						</NoticeIcon>
					),
				},
				actionProps: {
					children: "Compartilhar outra",
					onClick: () => {
						toast.close(id);
						openSourcePicker();
					},
				},
			});
			return id;
		}
		case "audioLost": {
			const id = toast.add({
				title: "O áudio do compartilhamento parou",
				description: "O vídeo continua sendo transmitido.",
				data: {
					media: (
						<NoticeIcon tone="warning">
							<VolumeXIcon />
						</NoticeIcon>
					),
				},
				actionProps: {
					children: "Tentar de novo",
					onClick: () => {
						toast.close(id);
						void restartShare(controller);
					},
				},
			});
			return id;
		}
		case "failed": {
			// Janela minimizada ou fechada entre a lista e o clique: o Rust não acha a fonte.
			const id = toast.add({
				title: "Não deu para compartilhar a tela",
				description:
					notice.errorKind === "SourceNotFound"
						? "A janela foi fechada ou minimizada. Escolha outra ou restaure a janela."
						: notice.message,
				data: {
					media: (
						<NoticeIcon tone="warning">
							<TriangleAlertIcon />
						</NoticeIcon>
					),
				},
				actionProps: {
					children: "Escolher de novo",
					onClick: () => {
						toast.close(id);
						openSourcePicker();
					},
				},
			});
			return id;
		}
	}
}

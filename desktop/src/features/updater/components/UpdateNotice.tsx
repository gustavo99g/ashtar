/**
 * Os avisos de atualização no canto (decisão 6 do PLAN da v0.2.0; quadros "Atualização: avisos" e
 * "Atualização: na sala de voz"): "Atualização pronta" quando o Rust termina de baixar uma versão,
 * a confirmação durante uma chamada, "Reiniciando…" e "Não deu para atualizar".
 *
 * Fica uma vez no `App`, montado o tempo todo: além de desenhar o aviso, escuta os eventos do Rust
 * e leva a ele o canal da API. Sem o clique, a versão é instalada ao fechar o app (no Rust). A
 * falha de rede ao procurar fica só no log, sem aviso.
 */
import {
	CircleAlertIcon,
	DownloadIcon,
	LoaderCircleIcon,
	PhoneOffIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SALA } from "@/features/voice";
import {
	onUpdateFailed,
	onUpdateReady,
	pendingUpdate,
} from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import {
	confirmRestart,
	hideUpdateNotice,
	restartToUpdate,
	updateFailed,
	updateReady,
	useUpdaterStore,
} from "../stores/updaterStore";
import { useInCall } from "../useInCall";
import { useUpdateChannelSync } from "../hooks/useUpdateChannelSync";

/** Liga os eventos do Rust ao estado. */
function useUpdateEvents() {
	useEffect(() => {
		let cancelled = false;
		const unlisteners = [
			onUpdateReady(({ version }) => updateReady(version)),
			onUpdateFailed(({ message }) => updateFailed(message)),
		];

		// A versão pode ter ficado pronta antes de este componente começar a escutar.
		void pendingUpdate()
			.then((version) => {
				if (!cancelled && version) updateReady(version);
			})
			.catch(() => {});

		return () => {
			cancelled = true;
			for (const unlisten of unlisteners) {
				void unlisten.then((stop) => stop());
			}
		};
	}, []);
}

function NoticeIcon({
	className,
	children,
}: {
	className: string;
	children: ReactNode;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-9 shrink-0 items-center justify-center rounded-full [&>svg]:size-[18px]",
				className,
			)}
		>
			{children}
		</span>
	);
}

function NoticeText({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<span className="flex min-w-0 flex-1 flex-col gap-0.5">
			<span className="text-sm font-semibold text-foreground">{title}</span>
			<span className="text-xs leading-[1.45] text-muted-foreground">
				{children}
			</span>
		</span>
	);
}

const actionClass = "px-3.5 text-[13px]";

export function UpdateNotice() {
	useUpdateChannelSync();
	useUpdateEvents();
	const notice = useUpdaterStore((state) => state.notice);
	const version = useUpdaterStore((state) => state.readyVersion);
	const inCall = useInCall();

	if (!notice) {
		return null;
	}

	return (
		<div
			role={notice.kind === "confirm" ? "alertdialog" : "status"}
			aria-label={notice.kind === "confirm" ? "Reiniciar agora?" : undefined}
			className={cn(
				"fixed right-4 z-50 flex w-[380px] max-w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-border-strong bg-popover py-3.5 pr-3.5 pl-4 text-popover-foreground shadow-toast",
				// Na chamada, o canto de baixo é da barra da sala (Microfone, Áudio, Tela): o aviso
				// fica logo acima dela.
				inCall ? "bottom-[94px]" : "bottom-4",
			)}
		>
			{notice.kind === "ready" && (
				<>
					<NoticeIcon className="bg-info-subtle text-info-text">
						<DownloadIcon />
					</NoticeIcon>
					<NoticeText title="Atualização pronta">
						Versão {version}. Ou feche o app: ela é instalada ao sair.
					</NoticeText>
					<Button
						size="sm"
						className={actionClass}
						onClick={() => restartToUpdate(inCall)}
					>
						Reiniciar
					</Button>
				</>
			)}
			{notice.kind === "confirm" && (
				<>
					<NoticeIcon className="bg-warning-subtle text-warning-text">
						<PhoneOffIcon />
					</NoticeIcon>
					<NoticeText title="Reiniciar agora?">
						Você sai da chamada na {SALA.name}.
					</NoticeText>
					<Button
						size="sm"
						variant="ghost"
						className="px-3 text-[13px] font-medium"
						onClick={hideUpdateNotice}
					>
						Depois
					</Button>
					<Button size="sm" className={actionClass} onClick={confirmRestart}>
						Reiniciar
					</Button>
				</>
			)}
			{notice.kind === "restarting" && (
				<>
					<NoticeIcon className="bg-info-subtle text-info-text">
						<LoaderCircleIcon className="motion-safe:animate-spin" />
					</NoticeIcon>
					<NoticeText title="Reiniciando…">
						O Ashtar volta sozinho em alguns segundos.
					</NoticeText>
				</>
			)}
			{notice.kind === "failed" && (
				<>
					<NoticeIcon className="bg-destructive-border/12 text-destructive-text">
						<CircleAlertIcon />
					</NoticeIcon>
					<NoticeText title="Não deu para atualizar">
						{notice.message}
					</NoticeText>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Fechar aviso"
						className="size-7 text-muted-foreground"
						onClick={hideUpdateNotice}
					>
						<XIcon className="size-3.5" />
					</Button>
				</>
			)}
		</div>
	);
}

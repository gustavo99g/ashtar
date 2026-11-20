/**
 * Configurações › Aplicativo (quadros "Aplicativo", "Aplicativo (estável)" e "Aplicativo
 * (atualização pronta)"): a versão, o "O que há de novo", o canal, o iniciar com o Windows e a
 * pasta de logs.
 *
 * O canal só aparece: quem muda é o dono, em Painel de controle › Membros, e o app recebe pelo
 * `/api/me` (ADR 0013). Com uma versão já baixada, "Procurar atualização" vira Reiniciar, que
 * pede a mesma confirmação do aviso no canto durante uma chamada.
 */
import {
	CrownIcon,
	DownloadIcon,
	FolderOpenIcon,
	LockIcon,
	RefreshCwIcon,
	SparklesIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import logo from "@/assets/ashtar.svg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SendLogs } from "@/features/admin";
import { useMe } from "@/features/identity";
import {
	autostartEnabled,
	checkForUpdateNow,
	openLogDir,
	setAutostart,
	type UpdateCheck,
} from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import {
	openWhatsNew,
	restartToUpdate,
	updateReady,
	useUpdaterStore,
} from "../stores/updaterStore";
import { useInCall } from "@/features/voice";

/**
 * Onde o Rust grava os logs (`app_log_dir`: a pasta local do Windows com o identificador do
 * `tauri.conf.json`). O `pnpm app:dev` usa o identificador do `tauri.dev.conf.json`.
 */
const LOG_DIR = import.meta.env.DEV
	? "%LOCALAPPDATA%\\com.gustavo99g.ashtar.dev\\logs"
	: "%LOCALAPPDATA%\\com.gustavo99g.ashtar\\logs";

/** O "Procurar atualização" antes do primeiro clique, enquanto procura e o que voltou. */
type CheckState = { status: "idle" } | { status: "checking" } | UpdateCheck;

const CHANNELS = {
	beta: {
		name: "Beta",
		description: "Você recebe as versões novas antes do grupo, para testar.",
	},
	stable: {
		name: "Estável",
		description: "Você recebe as versões depois que elas passam pelo beta.",
	},
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-4">
			<h2
				id={id}
				className="text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase"
			>
				{title}
			</h2>
			{children}
		</section>
	);
}

const cardClass = "flex items-center rounded-xl border border-border bg-card";
const outlineClass = "px-3.5 font-medium text-foreground";

/** A linha embaixo da versão. */
function CheckStatus({
	check,
	readyVersion,
}: {
	check: CheckState;
	readyVersion: string | null;
}) {
	if (readyVersion) {
		return (
			<span
				role="status"
				className="flex items-center gap-1.5 text-[13px] leading-tight text-info-text"
			>
				<DownloadIcon aria-hidden="true" className="size-3.5 shrink-0" />
				Versão {readyVersion} pronta. Ou feche o app: ela é instalada ao sair.
			</span>
		);
	}

	const [text, color] = (() => {
		switch (check.status) {
			case "idle":
			case "ready":
				return ["Você está na versão mais recente.", "text-success-text"];
			case "checking":
				return ["Procurando atualização…", "text-muted-foreground"];
			case "upToDate":
				return ["Nenhuma versão nova. Você está em dia.", "text-success-text"];
			case "offline":
				return [
					"Não deu para procurar agora. Confira a internet e tente de novo.",
					"text-destructive-text",
				];
			case "failed":
				return [
					`Não deu para atualizar. ${check.message}`,
					"text-destructive-text",
				];
			case "disabled":
				return [
					"No desenvolvimento, o app não se atualiza.",
					"text-muted-foreground",
				];
		}
	})();

	return (
		<span role="status" className={cn("text-[13px] leading-tight", color)}>
			{text}
		</span>
	);
}

/**
 * A chave do iniciar com o Windows, desligada por padrão. Ela pergunta ao Windows (pelo Rust) se
 * está ligada, em vez de guardar no app: a pessoa pode ter tirado o Ashtar da inicialização pelo
 * Gerenciador de Tarefas.
 */
function StartWithWindows() {
	const labelId = useId();
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let alive = true;
		autostartEnabled()
			.then((value) => alive && setEnabled(value))
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
		};
	}, []);

	function change(next: boolean) {
		const before = enabled;
		setEnabled(next);
		setFailed(false);
		setAutostart(next).catch(() => {
			setEnabled(before);
			setFailed(true);
		});
	}

	return (
		<div className={cn(cardClass, "justify-between gap-6 py-4 pr-[18px] pl-5")}>
			<span className="flex min-w-0 flex-col gap-1">
				<span
					id={labelId}
					className="text-sm leading-tight font-semibold text-foreground"
				>
					Iniciar com o Windows
				</span>
				<span className="text-xs leading-normal text-muted-foreground">
					O Ashtar abre junto com o computador, direto na bandeja, e já recebe as
					mensagens.
				</span>
				{failed && (
					<span role="alert" className="text-xs text-destructive-text">
						Não deu para mudar a inicialização do Windows. Tente de novo.
					</span>
				)}
			</span>
			<Switch
				variant="blue"
				aria-labelledby={labelId}
				checked={enabled ?? false}
				disabled={enabled === null}
				onCheckedChange={change}
			/>
		</div>
	);
}

export function AppSettings() {
	const me = useMe().data;
	const readyVersion = useUpdaterStore((state) => state.readyVersion);
	const inCall = useInCall();
	const [check, setCheck] = useState<CheckState>({ status: "idle" });
	const [logsFailed, setLogsFailed] = useState(false);

	const channel = me ? CHANNELS[me.update_channel] : null;
	const ownerBeta = me?.user.is_owner === true && me.update_channel === "beta";

	async function searchForUpdate() {
		setCheck({ status: "checking" });
		const result = await checkForUpdateNow().catch(
			(): UpdateCheck => ({ status: "offline" }),
		);
		// O evento `update-ready` também chega; aqui é só para não depender da ordem.
		if (result.status === "ready") updateReady(result.version);
		setCheck(result);
	}

	function openLogs() {
		setLogsFailed(false);
		openLogDir().catch(() => setLogsFailed(true));
	}

	return (
		<div className="flex w-full flex-col gap-9 py-20 pr-28 pl-32">
			<h1 className="text-[22px] leading-tight font-bold text-foreground">
				Aplicativo
			</h1>

			<Section title="Versão">
				<div className="flex flex-col gap-4">
					<div className={cn(cardClass, "gap-4 py-[18px] pr-[18px] pl-5")}>
						<img src={logo} alt="" className="size-12 shrink-0 rounded-2xl" />
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<span className="flex items-center gap-2">
								<span className="text-base leading-tight font-bold text-foreground">
									Ashtar {__APP_VERSION__}
								</span>
								{me && (
									<Badge
										tone={me.update_channel === "beta" ? "gold" : "success"}
										className="rounded-sm px-1.5 py-px text-[10px] font-bold tracking-[0.04em] uppercase"
									>
										{channel?.name}
									</Badge>
								)}
							</span>
							<CheckStatus check={check} readyVersion={readyVersion} />
						</div>
						{readyVersion ? (
							<Button
								className="px-[18px]"
								onClick={() => restartToUpdate(inCall)}
							>
								Reiniciar
							</Button>
						) : (
							<Button
								variant="outline"
								className={outlineClass}
								disabled={check.status === "checking"}
								onClick={searchForUpdate}
							>
								<RefreshCwIcon
									aria-hidden="true"
									className={cn(
										"size-[15px]",
										check.status === "checking" && "motion-safe:animate-spin",
									)}
								/>
								Procurar atualização
							</Button>
						)}
					</div>
					<button
						type="button"
						onClick={() => void openWhatsNew()}
						className="-ml-2.5 flex h-8 items-center gap-1.5 self-start rounded-md px-2.5 text-[13px] font-medium text-link hover:bg-secondary hover:text-foreground"
					>
						<SparklesIcon aria-hidden="true" className="size-[15px]" />
						Ver o que há de novo nesta versão
					</button>
				</div>
			</Section>

			{channel && (
				<Section title="Canal de atualização">
					<div className={cn(cardClass, "justify-between gap-6 px-5 py-4")}>
						<span className="flex flex-col gap-1">
							<span className="text-sm leading-tight font-semibold text-foreground">
								{channel.name}
							</span>
							<span className="text-xs leading-normal text-muted-foreground">
								{channel.description}
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
							{ownerBeta ? (
								<>
									<CrownIcon
										aria-hidden="true"
										className="size-3.5 text-gold"
									/>
									O dono sempre recebe o beta
								</>
							) : (
								<>
									<LockIcon
										aria-hidden="true"
										className="size-3.5 text-foreground-subtle"
									/>
									Definido pelo dono do grupo
								</>
							)}
						</span>
					</div>
				</Section>
			)}

			<Section title="Inicialização">
				<StartWithWindows />
			</Section>

			<Section title="Problemas">
				<div
					className={cn(cardClass, "justify-between gap-6 py-4 pr-[18px] pl-5")}
				>
					<span className="flex min-w-0 flex-col gap-1.5">
						<span className="text-sm leading-tight font-semibold text-foreground">
							Pasta de logs
						</span>
						<span className="text-xs leading-normal text-muted-foreground">
							Se algo der errado, use Enviar logs: os dos últimos 2 dias vão
							para o dono. A pasta guarda os últimos 7 dias.
						</span>
						<code className="self-start rounded-sm bg-rail px-1.5 py-0.5 font-mono text-[11px] leading-tight text-secondary-foreground">
							{LOG_DIR}
						</code>
						{logsFailed && (
							<span role="alert" className="text-xs text-destructive-text">
								Não deu para abrir a pasta. Abra o caminho acima no Explorador
								de Arquivos.
							</span>
						)}
					</span>
					<div className="flex shrink-0 flex-col gap-2">
						<SendLogs className={outlineClass} />
						<Button variant="outline" className={outlineClass} onClick={openLogs}>
							<FolderOpenIcon aria-hidden="true" className="size-[15px]" />
							Abrir pasta
						</Button>
					</div>
				</div>
			</Section>
		</div>
	);
}

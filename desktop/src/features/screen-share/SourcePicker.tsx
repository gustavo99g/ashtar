/**
 * Seletor do que compartilhar: fonte (janela ou tela), qualidade e áudio.
 *
 * Só monta um `ShareRequest` e o entrega ao controller; não sabe como a captura acontece.
 * Em plataformas onde o próprio sistema mostra o seletor (Wayland), este componente dá lugar
 * a só qualidade e áudio (decisão 14): por isso a escolha da fonte fica numa parte separada.
 */
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AudioMode, CaptureSource, Quality } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import type { ScreenShareController } from "./controller";
import { layoutMonitors } from "./monitorLayout";
import { DEFAULT_QUALITY, QUALITY_ORDER, QUALITY_PRESETS } from "./presets";

type Tab = "windows" | "screens";
type AudioChoice = AudioMode["mode"];

type Loaded =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; sources: CaptureSource[] };

interface SourcePickerProps {
	controller: ScreenShareController;
	channelName: string;
	onClose: () => void;
}

const MONITOR_AREA = { width: 750, height: 298 };

const AUDIO_OPTIONS: Record<AudioChoice, { label: string; hint: string }> = {
	off: { label: "Sem áudio", hint: "O compartilhamento vai sem som." },
	application: {
		label: "Só do aplicativo",
		hint: "Apenas o som da janela escolhida.",
	},
	system: {
		label: "Todo o sistema",
		hint: "Tudo que toca no computador, menos as vozes da chamada.",
	},
};

function sourceKey(source: CaptureSource) {
	return `${source.source.kind}:${source.source.id}`;
}

function toAudioMode(
	choice: AudioChoice,
	source: CaptureSource | null,
): AudioMode {
	if (choice === "application") {
		// A opção fica desabilitada sem PID; o fallback é só por segurança.
		return source?.processId != null
			? { mode: "application", processId: source.processId }
			: { mode: "off" };
	}
	return { mode: choice };
}

/** Intervalo entre o fim de uma atualização da lista de fontes e o pedido seguinte. */
const SOURCES_REFRESH_MS = 2000;

export function SourcePicker({
	controller,
	channelName,
	onClose,
}: SourcePickerProps) {
	const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
	const [tab, setTab] = useState<Tab>("windows");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);
	const [audio, setAudio] = useState<AudioChoice>("application");

	// Recarrega a lista enquanto o seletor está aberto, para uma janela restaurada ou aberta agora
	// aparecer sem reabrir. O próximo pedido só é agendado quando o anterior termina (cada um leva
	// ~100 ms com poucas janelas, por causa dos ícones), então eles nunca se acumulam. Janelas
	// minimizadas continuam fora: o libwebrtc não as lista nem as captura.
	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		function schedule() {
			if (!cancelled) timer = setTimeout(load, SOURCES_REFRESH_MS);
		}

		function load() {
			controller.listSources().then(
				(sources) => {
					if (cancelled) return;
					setLoaded({ status: "ready", sources });
					schedule();
				},
				(error: unknown) => {
					if (cancelled) return;
					// Uma falha numa atualização não derruba a lista que já está na tela.
					setLoaded((current) => {
						if (current.status === "ready") return current;
						const message =
							typeof error === "object" && error !== null && "message" in error
								? String(error.message)
								: String(error);
						return { status: "error", message };
					});
					schedule();
				},
			);
		}

		load();

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [controller]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const sources = loaded.status === "ready" ? loaded.sources : [];
	const windows = sources.filter((s) => s.source.kind === "window");
	const screens = sources.filter((s) => s.source.kind === "monitor");
	const selected = sources.find((s) => sourceKey(s) === selectedKey) ?? null;

	const audioChoices: AudioChoice[] =
		tab === "windows" ? ["off", "application", "system"] : ["off", "system"];

	// Sem PID não dá para capturar só o áudio da janela: a opção fica desabilitada, e a escolha
	// vale como "Sem áudio" (e é assim que aparece), em vez de cair nisso sem a pessoa saber.
	const effectiveAudio: AudioChoice =
		audio === "application" && selected !== null && selected.processId == null
			? "off"
			: audio;

	function changeTab(next: Tab) {
		setTab(next);
		setSelectedKey(null);
		setAudio(next === "windows" ? "application" : "system");
	}

	function share() {
		if (!selected) return;
		void controller.start({
			source: selected,
			quality,
			audio: toAudioMode(effectiveAudio, selected),
		});
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="source-picker-title"
				className="flex w-[800px] max-w-full flex-col gap-5 rounded-xl border border-line-strong bg-float p-6"
			>
				<header className="flex items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h2
							id="source-picker-title"
							className="text-xl font-bold text-primary"
						>
							Compartilhar tela
						</h2>
						<span className="text-sm text-muted">
							Escolha o que as pessoas em {channelName} vão ver.
						</span>
					</div>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Fechar"
						onClick={onClose}
					>
						×
					</Button>
				</header>

				<div
					role="group"
					aria-label="Tipo de fonte"
					className="flex self-start rounded-lg border border-line-strong bg-surface-low p-0.5"
				>
					<TabButton
						pressed={tab === "windows"}
						onClick={() => changeTab("windows")}
					>
						Janelas
					</TabButton>
					<TabButton
						pressed={tab === "screens"}
						onClick={() => changeTab("screens")}
					>
						Telas
					</TabButton>
				</div>

				<div className="h-[360px] overflow-y-auto">
					{loaded.status === "loading" && (
						<Centered>Procurando janelas e telas...</Centered>
					)}
					{loaded.status === "error" && (
						<Centered>
							Não foi possível listar as fontes: {loaded.message}
						</Centered>
					)}
					{loaded.status === "ready" &&
						(tab === "windows" ? (
							<WindowGrid
								windows={windows}
								selectedKey={selectedKey}
								onSelect={setSelectedKey}
							/>
						) : (
							<ScreenLayout
								screens={screens}
								selectedKey={selectedKey}
								onSelect={setSelectedKey}
							/>
						))}
				</div>

				<div className="grid grid-cols-2 gap-6 border-t border-line-strong pt-4">
					<div className="flex flex-col gap-2.5">
						<SectionLabel>Qualidade</SectionLabel>
						<fieldset
							role="group"
							aria-label="Qualidade"
							className="flex gap-2"
						>
							{QUALITY_ORDER.map((value) => {
								const preset = QUALITY_PRESETS[value];
								const on = value === quality;
								return (
									<button
										key={value}
										type="button"
										aria-pressed={on}
										onClick={() => setQuality(value)}
										className={cn(
											"flex h-15 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border-2",
											on
												? "border-accent bg-selected"
												: "border-line-strong hover:bg-hover",
										)}
									>
										<span
											className={cn(
												"text-sm font-semibold",
												on ? "text-primary" : "text-muted",
											)}
										>
											{preset.label}
										</span>
										<span className="font-mono text-xs text-muted">
											{preset.spec}
										</span>
									</button>
								);
							})}
						</fieldset>
						<span className="text-xs text-muted">
							{QUALITY_PRESETS[quality].description}
						</span>
					</div>

					<fieldset className="flex flex-col gap-2.5">
						<legend className="mb-2.5">
							<SectionLabel>Áudio</SectionLabel>
						</legend>
						{audioChoices.map((choice) => {
							const disabled =
								choice === "application" &&
								selected !== null &&
								selected.processId == null;
							return (
								<label
									key={choice}
									className={cn(
										"flex items-start gap-2.5",
										disabled ? "opacity-50" : "cursor-pointer",
									)}
								>
									<input
										type="radio"
										name="screen-share-audio"
										className="mt-0.5 size-4 accent-accent"
										checked={effectiveAudio === choice}
										disabled={disabled}
										onChange={() => setAudio(choice)}
									/>
									<span className="flex flex-col gap-0.5">
										<span className="text-sm font-medium text-primary">
											{AUDIO_OPTIONS[choice].label}
										</span>
										<span className="text-xs text-muted">
											{AUDIO_OPTIONS[choice].hint}
										</span>
									</span>
								</label>
							);
						})}
					</fieldset>
				</div>

				<footer className="flex items-center gap-4 border-t border-line-strong pt-4">
					<span className="min-w-0 flex-1 truncate text-sm text-muted">
						{selected ? (
							<>
								{selected.source.kind === "window" ? "Janela" : "Tela"}:{" "}
								<span className="font-semibold text-primary">
									{selected.title}
								</span>
							</>
						) : (
							"Nada selecionado."
						)}
					</span>
					<Button variant="ghost" onClick={onClose}>
						Cancelar
					</Button>
					<Button disabled={!selected} onClick={share}>
						Compartilhar
					</Button>
				</footer>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------

function TabButton({
	pressed,
	onClick,
	children,
}: {
	pressed: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"h-8 rounded-md px-3.5 text-sm font-semibold",
				pressed ? "bg-selected text-primary" : "text-muted hover:text-primary",
			)}
		>
			{children}
		</button>
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<span className="text-xs font-bold tracking-wider text-muted uppercase">
			{children}
		</span>
	);
}

function Centered({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-full items-center justify-center text-sm text-muted">
			{children}
		</div>
	);
}

function SelectedMark() {
	return (
		<span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-accent text-xs text-inverse">
			✓
		</span>
	);
}

interface ListProps {
	selectedKey: string | null;
	onSelect: (key: string) => void;
}

function WindowGrid({
	windows,
	selectedKey,
	onSelect,
}: ListProps & { windows: CaptureSource[] }) {
	if (windows.length === 0) {
		return <Centered>Nenhuma janela disponível.</Centered>;
	}

	return (
		<div className="grid grid-cols-3 gap-4">
			{windows.map((entry) => {
				const key = sourceKey(entry);
				const selected = key === selectedKey;
				return (
					<button
						key={key}
						type="button"
						aria-pressed={selected}
						onClick={() => onSelect(key)}
						className="flex min-w-0 flex-col gap-2 text-left"
					>
						<span
							className={cn(
								"relative flex aspect-video items-center justify-center rounded-lg border-2 bg-surface-low",
								selected
									? "border-accent"
									: "border-line-strong hover:bg-hover",
							)}
						>
							{entry.icon ? (
								<img src={entry.icon} alt="" className="size-12" />
							) : (
								<span className="flex size-12 items-center justify-center rounded-xl bg-raised text-xl font-bold text-primary">
									{entry.title.charAt(0).toUpperCase()}
								</span>
							)}
							{selected && <SelectedMark />}
						</span>
						<span className="truncate text-sm text-primary">
							{entry.title}
						</span>
					</button>
				);
			})}
		</div>
	);
}

function ScreenLayout({
	screens,
	selectedKey,
	onSelect,
}: ListProps & { screens: CaptureSource[] }) {
	const placed = layoutMonitors(
		screens,
		MONITOR_AREA.width,
		MONITOR_AREA.height,
	);

	if (placed.length === 0) {
		return <Centered>Nenhuma tela disponível.</Centered>;
	}

	return (
		<div className="flex flex-col gap-3">
			<div
				role="group"
				aria-label="Disposição das telas"
				className="relative rounded-lg border border-line-strong bg-surface-low"
				style={{ width: MONITOR_AREA.width, height: MONITOR_AREA.height }}
			>
				{placed.map(({ source, monitor, left, top, width, height }) => {
					const key = sourceKey(source);
					const selected = key === selectedKey;
					const resolution = `${monitor.width} × ${monitor.height}`;
					return (
						<button
							key={key}
							type="button"
							aria-pressed={selected}
							aria-label={`${source.title}, ${resolution}`}
							onClick={() => onSelect(key)}
							style={{ left, top, width, height }}
							className={cn(
								"absolute flex flex-col items-center justify-center gap-1.5 rounded-lg border-2",
								selected
									? "border-accent bg-selected"
									: "border-line-strong bg-float hover:bg-hover",
							)}
						>
							<span className="font-mono text-xs text-secondary">
								{resolution}
							</span>
							<span className="text-sm font-semibold text-primary">
								{source.title}
							</span>
							{selected && <SelectedMark />}
						</button>
					);
				})}
			</div>
			<span className="text-xs text-muted">
				A disposição segue a das configurações de vídeo do Windows. Clique na
				tela que quer compartilhar.
			</span>
		</div>
	);
}

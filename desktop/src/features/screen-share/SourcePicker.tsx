/**
 * Seletor do que compartilhar: fonte (janela ou tela), qualidade e áudio.
 *
 * Só monta um `ShareRequest` e o entrega ao controller; não sabe como a captura acontece.
 * Em plataformas onde o próprio sistema mostra o seletor (Wayland), este componente dá lugar
 * a só qualidade e áudio (decisão 14): por isso a escolha da fonte fica numa parte separada.
 *
 * Janelas minimizadas não aparecem: o libwebrtc as tira da lista e não as captura (BACKLOG).
 */
import { CheckIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AudioMode, CaptureSource, Quality } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import type { ScreenShareController } from "./controller";
import { layoutMonitors } from "./monitorLayout";
import { startShare } from "./pickerStore";
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
	open: boolean;
	onClose: () => void;
}

/** A área de dentro da moldura das telas: 800 do diálogo, menos o respiro e a borda. */
const MONITOR_AREA = { width: 748, height: 298 };

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

/** O diálogo. O conteúdo só existe aberto: cada abertura começa do zero e recarrega a lista. */
export function SourcePicker({
	controller,
	channelName,
	open,
	onClose,
}: SourcePickerProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="flex max-h-[calc(100%-2rem)] flex-col gap-5 overflow-y-auto rounded-[14px] border-border p-6 sm:max-w-[800px]">
				<PickerBody
					controller={controller}
					channelName={channelName}
					onClose={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}

function PickerBody({
	controller,
	channelName,
	onClose,
}: Omit<SourcePickerProps, "open">) {
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
		void startShare(controller, {
			source: selected,
			quality,
			audio: toAudioMode(effectiveAudio, selected),
		});
		onClose();
	}

	const content = (list: ReactNode) => {
		if (loaded.status === "loading")
			return <Centered>Procurando janelas e telas...</Centered>;
		if (loaded.status === "error") {
			return (
				<Centered>Não foi possível listar as fontes: {loaded.message}</Centered>
			);
		}
		return list;
	};

	return (
		<>
			<header className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<DialogTitle className="text-xl font-bold">
						Compartilhar tela
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-normal">
						Escolha o que as pessoas em {channelName} vão ver.
					</DialogDescription>
				</div>
				<DialogClose
					render={
						<Button
							variant="ghost"
							size="icon"
							className="text-muted-foreground"
						/>
					}
					aria-label="Fechar"
				>
					<XIcon className="size-[18px]" />
				</DialogClose>
			</header>

			<Tabs
				value={tab}
				onValueChange={(next: Tab) => changeTab(next)}
				className="min-h-47 gap-5"
			>
				<TabsList
					aria-label="Tipo de fonte"
					className="rounded-[10px] bg-background"
				>
					<TabsTrigger value="windows" className={TAB_CLASS}>
						Janelas
					</TabsTrigger>
					<TabsTrigger value="screens" className={TAB_CLASS}>
						Telas
					</TabsTrigger>
				</TabsList>
				<TabsContent
					value="windows"
					className="h-[360px] min-h-32 overflow-y-auto"
				>
					{content(
						<WindowGrid
							windows={windows}
							selectedKey={selectedKey}
							onSelect={setSelectedKey}
						/>,
					)}
				</TabsContent>
				<TabsContent
					value="screens"
					className="h-[360px] min-h-32 overflow-y-auto"
				>
					{content(
						<ScreenLayout
							screens={screens}
							selectedKey={selectedKey}
							onSelect={setSelectedKey}
						/>,
					)}
				</TabsContent>
			</Tabs>

			<div className="grid grid-cols-2 gap-6 border-t border-border pt-4">
				<div className="flex flex-col gap-2.5">
					<SectionLabel>Qualidade</SectionLabel>
					<div role="group" aria-label="Qualidade" className="flex gap-2">
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
										"flex h-15 flex-1 flex-col items-center justify-center gap-[3px] rounded-lg border-2 transition-colors",
										on
											? "border-ring bg-secondary"
											: "border-border hover:bg-secondary",
									)}
								>
									<span
										className={cn(
											"text-[13px] font-semibold",
											on ? "text-foreground" : "text-muted-foreground",
										)}
									>
										{preset.label}
									</span>
									<span className="font-mono text-[11px] text-muted-foreground">
										{preset.spec}
									</span>
								</button>
							);
						})}
					</div>
					<span className="text-xs leading-normal text-muted-foreground">
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
									className="mt-0.5 size-4 accent-ring"
									checked={effectiveAudio === choice}
									disabled={disabled}
									onChange={() => setAudio(choice)}
								/>
								<span className="flex flex-col gap-0.5">
									<span className="text-sm font-medium text-foreground">
										{AUDIO_OPTIONS[choice].label}
									</span>
									<span className="text-xs leading-[1.45] text-muted-foreground">
										{AUDIO_OPTIONS[choice].hint}
									</span>
								</span>
							</label>
						);
					})}
				</fieldset>
			</div>

			<footer className="flex items-center gap-4 border-t border-border pt-4">
				<span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
					{selected ? (
						<>
							{selected.source.kind === "window" ? "Janela" : "Tela"}:{" "}
							<span className="font-semibold text-foreground">
								{selected.title}
							</span>
						</>
					) : (
						"Nada selecionado."
					)}
				</span>
				<Button
					variant="ghost"
					className="h-10 text-sm font-medium"
					onClick={onClose}
				>
					Cancelar
				</Button>
				<Button
					className="h-10 px-[18px] text-sm"
					disabled={!selected}
					onClick={share}
				>
					Compartilhar
				</Button>
			</footer>
		</>
	);
}

// ---------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------

/** A aba ativa do seletor fica no cinza-azulado do quadro, não no azul das outras abas. */
const TAB_CLASS =
	"h-8 rounded-[7px] font-semibold text-muted-foreground data-active:bg-secondary data-active:text-foreground";

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
			{children}
		</span>
	);
}

function Centered({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
			{children}
		</div>
	);
}

function SelectedMark() {
	return (
		<span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
			<CheckIcon className="size-3.5" strokeWidth={2.5} />
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
						className="group flex min-w-0 flex-col gap-2 text-left"
					>
						<span
							className={cn(
								"relative flex aspect-video items-center justify-center rounded-lg border-2 bg-background transition-colors",
								selected
									? "border-ring"
									: "border-border group-hover:border-border-strong",
							)}
						>
							{entry.icon ? (
								<img src={entry.icon} alt="" className="size-13" />
							) : (
								<span
									aria-hidden="true"
									className="flex size-13 items-center justify-center rounded-xl bg-border-strong text-[22px] font-bold text-foreground"
								>
									{entry.title.charAt(0).toUpperCase()}
								</span>
							)}
							{selected && <SelectedMark />}
						</span>
						<span className="truncate text-[13px] text-foreground">
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
				className="relative h-[300px] rounded-[10px] border border-border bg-background"
			>
				{placed.map(({ source, monitor, left, top, width, height }) => {
					const key = sourceKey(source);
					const selected = key === selectedKey;
					const resolution = `${monitor.width} × ${monitor.height}`;
					// O número é a posição na lista do Rust, o mesmo do título ("Tela 2").
					const number = screens.indexOf(source) + 1;
					return (
						<button
							key={key}
							type="button"
							aria-pressed={selected}
							aria-label={`${source.title}, ${resolution}`}
							onClick={() => onSelect(key)}
							style={{ left, top, width, height }}
							className={cn(
								"absolute flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 transition-colors",
								selected
									? "border-ring bg-secondary"
									: "border-border bg-card hover:border-border-strong",
							)}
						>
							<span
								className={cn(
									"text-[32px] leading-none font-bold",
									selected ? "text-foreground" : "text-muted-foreground",
								)}
							>
								{number}
							</span>
							<span className="font-mono text-xs text-secondary-foreground">
								{resolution}
							</span>
							{monitor.isPrimary && (
								<span className="rounded-sm bg-info-subtle px-2 py-0.5 text-[11px] font-semibold text-link-hover">
									Principal
								</span>
							)}
							{selected && <SelectedMark />}
						</button>
					);
				})}
			</div>
			<span className="text-xs leading-normal text-muted-foreground">
				A disposição segue a das configurações de vídeo do Windows. Clique na
				tela que quer compartilhar.
			</span>
		</div>
	);
}

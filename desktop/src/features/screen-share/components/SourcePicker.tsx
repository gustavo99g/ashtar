/**
 * Seletor do que compartilhar: fonte (janela ou tela), qualidade, áudio e cursor.
 *
 * Só monta um `ShareRequest` e o entrega ao controller; não sabe como a captura acontece. No modo
 * `change` (o "Trocar fonte" do painel), só escolhe a fonte e troca a da transmissão no ar.
 *
 * Cada card mostra a janela ao vivo (`useThumbnails`, ADR 0019), mas só os que estão à vista
 * pedem imagem ao Rust. Janelas minimizadas aparecem com o selo e o ícone: não desenham nada
 * enquanto estão minimizadas, e voltam à frente quando a transmissão começa.
 */
import { CheckIcon, XIcon } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
	AudioMode,
	CaptureSource,
	Quality,
	SourceRef,
} from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { useThumbnails } from "../hooks/useThumbnails";
import type { ScreenShareController } from "../model/controller";
import { layoutMonitors } from "../model/monitorLayout";
import {
	DEFAULT_QUALITY,
	QUALITY_ORDER,
	QUALITY_PRESETS,
} from "../model/presets";
import {
	changeSource,
	type PickerMode,
	startShare,
} from "../stores/pickerStore";

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
	/** `start` (o padrão): começa. `change`: troca a fonte da transmissão no ar. */
	mode?: PickerMode;
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
	mode = "start",
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
					mode={mode}
					onClose={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}

function PickerBody({
	controller,
	channelName,
	mode,
	onClose,
}: Omit<SourcePickerProps, "open"> & { mode: PickerMode }) {
	const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
	const [tab, setTab] = useState<Tab>("windows");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);
	const [audio, setAudio] = useState<AudioChoice>("application");
	const [cursor, setCursor] = useState(true);
	const [failure, setFailure] = useState<string | null>(null);
	const visible = useVisibleCards();

	// Recarrega a lista enquanto o seletor está aberto, para uma janela aberta agora aparecer sem
	// reabrir. O próximo pedido só é agendado quando o anterior termina (cada um leva ~100 ms com
	// poucas janelas, por causa dos ícones), então eles nunca se acumulam.
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

	// As miniaturas da aba aberta: as janelas à vista (as minimizadas não desenham) e todas as telas.
	const wanted = useMemo<SourceRef[]>(() => {
		if (tab === "screens") return screens.map((s) => s.source);
		return windows
			.filter((s) => !s.minimized && visible.keys.has(sourceKey(s)))
			.map((s) => s.source);
	}, [tab, windows, screens, visible.keys]);
	const thumbnails = useThumbnails(loaded.status === "ready" ? wanted : null);

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

	async function share() {
		if (!selected) return;
		if (mode === "change") {
			setFailure(null);
			try {
				await changeSource(controller, selected);
				onClose();
			} catch (error) {
				setFailure(
					typeof error === "object" && error !== null && "message" in error
						? String(error.message)
						: String(error),
				);
			}
			return;
		}
		void startShare(controller, {
			source: selected,
			quality,
			audio: toAudioMode(effectiveAudio, selected),
			cursor,
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
						{mode === "change" ? "Trocar a fonte" : "Compartilhar tela"}
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-normal">
						{mode === "change"
							? `Quem está assistindo em ${channelName} continua na tela.`
							: `Escolha o que as pessoas em ${channelName} vão ver.`}
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
							thumbnails={thumbnails}
							observe={visible.observe}
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
							thumbnails={thumbnails}
							selectedKey={selectedKey}
							onSelect={setSelectedKey}
						/>,
					)}
				</TabsContent>
			</Tabs>

			{mode === "start" && (
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
						<label className="mt-1 flex cursor-pointer items-center gap-2.5 border-t border-border pt-3">
							<input
								type="checkbox"
								className="size-4 accent-ring"
								checked={cursor}
								onChange={(event) => setCursor(event.target.checked)}
							/>
							<span className="text-sm font-medium text-foreground">
								Mostrar o cursor
							</span>
						</label>
					</fieldset>
				</div>
			)}

			<footer className="flex items-center gap-4 border-t border-border pt-4">
				<span
					role={failure ? "alert" : undefined}
					className={cn(
						"min-w-0 flex-1 truncate text-[13px]",
						failure ? "text-destructive" : "text-muted-foreground",
					)}
				>
					{failure ? (
						`Não deu para trocar: ${failure}`
					) : selected ? (
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
					onClick={() => void share()}
				>
					{mode === "change" ? "Trocar" : "Compartilhar"}
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

/**
 * Quais cards estão à vista na lista que rola. Sem `IntersectionObserver` (os testes), todos
 * contam como à vista.
 */
function useVisibleCards() {
	const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
	const observer = useRef<IntersectionObserver | null>(null);
	const elements = useRef(new Map<Element, string>());

	useEffect(() => {
		if (typeof IntersectionObserver === "undefined") return;
		const watching = elements.current;
		observer.current = new IntersectionObserver((entries) => {
			setKeys((current) => {
				const next = new Set(current);
				for (const entry of entries) {
					const key = watching.get(entry.target);
					if (key === undefined) continue;
					if (entry.isIntersecting) next.add(key);
					else next.delete(key);
				}
				return next;
			});
		});
		for (const element of watching.keys()) observer.current.observe(element);
		return () => {
			observer.current?.disconnect();
			observer.current = null;
		};
	}, []);

	// Um `ref` por chave, sempre o mesmo: um novo a cada desenho tiraria e poria o card de volta,
	// e o card sairia e voltaria da lista de visíveis a cada desenho (e, com ela, as miniaturas
	// pedidas ao Rust, que recomeçaria todas as capturas). O `ref` nunca sai deste mapa: o
	// `StrictMode` do dev solta e põe o `ref` de novo na montagem, e tirar do mapa nessa hora fazia
	// o `ref` seguinte ser outro, e o ciclo não parava.
	const refs = useRef(
		new Map<string, (element: HTMLElement | null) => () => void>(),
	);

	/** O `ref` do card de `key`. */
	const observe = useCallback((key: string) => {
		let ref = refs.current.get(key);
		if (!ref) {
			ref = (element: HTMLElement | null) => {
				if (element) {
					elements.current.set(element, key);
					if (observer.current) observer.current.observe(element);
					else if (typeof IntersectionObserver === "undefined")
						setKeys((current) =>
							current.has(key) ? current : new Set(current).add(key),
						);
				}
				return () => {
					if (!element) return;
					elements.current.delete(element);
					observer.current?.unobserve(element);
					setKeys((current) => {
						if (!current.has(key)) return current;
						const next = new Set(current);
						next.delete(key);
						return next;
					});
				};
			};
			refs.current.set(key, ref);
		}
		return ref;
	}, []);

	return { keys, observe };
}

interface ListProps {
	selectedKey: string | null;
	onSelect: (key: string) => void;
	/** As imagens ao vivo, pela `sourceKey`. */
	thumbnails: ReadonlyMap<string, string>;
}

function SourceIcon({
	entry,
	className,
}: {
	entry: CaptureSource;
	className?: string;
}) {
	return entry.icon ? (
		<img src={entry.icon} alt="" className={cn("size-13", className)} />
	) : (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-13 items-center justify-center rounded-xl bg-border-strong text-[22px] font-bold text-foreground",
				className,
			)}
		>
			{entry.title.charAt(0).toUpperCase()}
		</span>
	);
}

function WindowGrid({
	windows,
	thumbnails,
	observe,
	selectedKey,
	onSelect,
}: ListProps & {
	windows: CaptureSource[];
	observe: (key: string) => (element: HTMLElement | null) => () => void;
}) {
	if (windows.length === 0) {
		return <Centered>Nenhuma janela disponível.</Centered>;
	}

	return (
		<div className="grid grid-cols-3 gap-4">
			{windows.map((entry) => {
				const key = sourceKey(entry);
				const selected = key === selectedKey;
				const live = thumbnails.get(key);
				return (
					<button
						key={key}
						ref={observe(key)}
						type="button"
						aria-pressed={selected}
						aria-label={
							entry.minimized ? `${entry.title}, minimizada` : entry.title
						}
						onClick={() => onSelect(key)}
						className="group flex min-w-0 flex-col gap-2 text-left"
					>
						<span
							className={cn(
								"relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border-2 bg-background transition-colors",
								selected
									? "border-ring"
									: "border-border group-hover:border-border-strong",
							)}
						>
							{live ? (
								<>
									<img src={live} alt="" className="size-full object-contain" />
									<SourceIcon
										entry={entry}
										className="absolute bottom-1.5 left-1.5 size-6 rounded-md text-xs"
									/>
								</>
							) : (
								<SourceIcon entry={entry} />
							)}
							{entry.minimized && (
								<span className="absolute top-2 left-2 rounded-sm bg-background/90 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
									Minimizada
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
	thumbnails,
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
					const live = thumbnails.get(key);
					return (
						<button
							key={key}
							type="button"
							aria-pressed={selected}
							aria-label={`${source.title}, ${resolution}`}
							onClick={() => onSelect(key)}
							style={{ left, top, width, height }}
							className={cn(
								"absolute flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border-2 transition-colors",
								selected
									? "border-ring bg-secondary"
									: "border-border bg-card hover:border-border-strong",
							)}
						>
							{live && (
								<img
									src={live}
									alt=""
									className="absolute inset-0 size-full object-cover opacity-40"
								/>
							)}
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

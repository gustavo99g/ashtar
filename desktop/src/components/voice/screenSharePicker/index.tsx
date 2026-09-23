import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	listScreenShareMonitors,
	listScreenShareWindows,
	type MonitorSource,
	type ScreenShareSelection,
	startMonitorPreview,
	startWindowPreview,
	stopAllScreenSharePreviews,
	testListWebrtcWindows,
	type WindowPreviewFrame,
	type WindowSource,
} from "@/lib/tauri/commands";

export type { ScreenShareSelection } from "@/lib/tauri/commands";

type ScreenSharePickerProps = {
	open: boolean;
	onClose: () => void;
	onConfirm: (selection: ScreenShareSelection) => void;
};

type PreviewMap = Record<string, string>;

const getPreviewKey = (frame: WindowPreviewFrame) => {
	return `${frame.source_type}:${frame.source_id}`;
};

const ScreenSharePicker = ({
	open,
	onClose,
	onConfirm,
}: ScreenSharePickerProps) => {
	const [activeTab, setActiveTab] = useState<"windows" | "monitors">("windows");

	const [windows, setWindows] = useState<WindowSource[]>([]);

	const [monitors, setMonitors] = useState<MonitorSource[]>([]);

	const [selected, setSelected] = useState<ScreenShareSelection | null>(null);

	const [previews, setPreviews] = useState<PreviewMap>({});

	const previewUrls = useRef<Record<string, string>>({});

	const loadedRef = useRef(false);

	const handleFrame = useCallback((frame: WindowPreviewFrame) => {
		const key = getPreviewKey(frame);

		const bytes = new Uint8Array(frame.data);

		const blob = new Blob([bytes], {
			type: frame.mime_type,
		});

		const url = URL.createObjectURL(blob);

		const previous = previewUrls.current[key];

		if (previous) {
			URL.revokeObjectURL(previous);
		}

		previewUrls.current[key] = url;

		setPreviews((current) => ({
			...current,
			[key]: url,
		}));
	}, []);

	useEffect(() => {
		if (!open) {
			return;
		}

		let cancelled = false;

		async function load() {
			await testListWebrtcWindows();

			try {
				const [nextWindows, nextMonitors] = await Promise.all([
					listScreenShareWindows(),
					listScreenShareMonitors(),
				]);

				if (cancelled) {
					return;
				}

				setWindows(nextWindows);
				setMonitors(nextMonitors);

				if (loadedRef.current) {
					return;
				}

				loadedRef.current = true;

				await Promise.all([
					...nextWindows.map((window) =>
						startWindowPreview(window.id, handleFrame),
					),
					...nextMonitors.map((monitor) =>
						startMonitorPreview(monitor.id, handleFrame),
					),
				]);
			} catch (error) {
				console.error("Erro ao carregar fontes de screen share:", error);
			}
		}

		void load();

		return () => {
			cancelled = true;
		};
	}, [open, handleFrame]);

	useEffect(() => {
		if (open) {
			return;
		}

		loadedRef.current = false;

		void stopAllScreenSharePreviews();

		for (const url of Object.values(previewUrls.current)) {
			URL.revokeObjectURL(url);
		}

		previewUrls.current = {};
		setPreviews({});
		setSelected(null);
	}, [open]);

	if (!open) {
		return null;
	}

	function confirm() {
		if (!selected) {
			return;
		}

		onConfirm(selected);
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
			<div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden border border-line bg-float">
				<header className="flex items-center justify-between border-b border-line px-5 py-4">
					<div>
						<h2 className="text-primary text-lg font-semibold">
							Compartilhar tela
						</h2>

						<p className="text-secondary mt-1 text-sm">
							Escolha uma janela ou monitor.
						</p>
					</div>

					<Button variant="ghost" size="icon-sm" onClick={onClose}>
						×
					</Button>
				</header>

				<div className="flex border-b border-line px-4">
					<Button
						variant={activeTab === "windows" ? "secondary" : "ghost"}
						className="rounded-none"
						onClick={() => setActiveTab("windows")}
					>
						Aplicativos
					</Button>

					<Button
						variant={activeTab === "monitors" ? "secondary" : "ghost"}
						className="rounded-none"
						onClick={() => setActiveTab("monitors")}
					>
						Monitores
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-5">
					{activeTab === "windows" ? (
						<WindowGrid
							windows={windows}
							previews={previews}
							selected={selected}
							onSelect={(source) =>
								setSelected({
									type: "window",
									source,
								})
							}
						/>
					) : (
						<MonitorGrid
							monitors={monitors}
							previews={previews}
							selected={selected}
							onSelect={(source) =>
								setSelected({
									type: "monitor",
									source,
								})
							}
						/>
					)}
				</div>

				<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
					<Button variant="ghost" onClick={onClose}>
						Cancelar
					</Button>

					<Button disabled={!selected} onClick={confirm}>
						Compartilhar
					</Button>
				</footer>
			</div>
		</div>
	);
};

type WindowGridProps = {
	windows: WindowSource[];
	previews: PreviewMap;
	selected: ScreenShareSelection | null;
	onSelect: (source: WindowSource) => void;
};

function WindowGrid({
	windows,
	previews,
	selected,
	onSelect,
}: WindowGridProps) {
	if (windows.length === 0) {
		return (
			<div className="text-secondary flex min-h-64 items-center justify-center">
				Nenhuma janela disponível.
			</div>
		);
	}

	return (
		<div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
			{windows.map((window) => {
				const key = `window:${window.id}`;

				const isSelected =
					selected?.type === "window" && selected.source.id === window.id;

				return (
					<button
						key={window.id}
						type="button"
						onClick={() => onSelect(window)}
						className={[
							"group overflow-hidden border text-left transition-colors",
							isSelected
								? "border-line-focus bg-selected"
								: "border-line bg-surface hover:bg-hover",
						].join(" ")}
					>
						<div className="aspect-video overflow-hidden bg-surface-low">
							{previews[key] ? (
								<img
									src={previews[key]}
									alt=""
									className="h-full w-full object-cover"
								/>
							) : (
								<div className="text-faint flex h-full items-center justify-center text-sm">
									Preview indisponível
								</div>
							)}
						</div>
						<div className="flex items-center gap-2">
							{window.icon ? (
								<img src={window.icon} alt="" className="size-5 shrink-0" />
							) : (
								<div className="bg-surface-alt size-5 shrink-0" />
							)}

							<div className="min-w-0">
								<div className="text-primary truncate text-sm font-medium">
									{window.title}
								</div>

								<div className="text-muted truncate text-xs">
									PID {window.process_id}
								</div>
							</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}

type MonitorGridProps = {
	monitors: MonitorSource[];
	previews: PreviewMap;
	selected: ScreenShareSelection | null;
	onSelect: (source: MonitorSource) => void;
};

function MonitorGrid({
	monitors,
	previews,
	selected,
	onSelect,
}: MonitorGridProps) {
	return (
		<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
			{monitors.map((monitor) => {
				const key = `monitor:${monitor.id}`;

				const isSelected =
					selected?.type === "monitor" && selected.source.id === monitor.id;

				return (
					<button
						key={monitor.id}
						type="button"
						onClick={() => onSelect(monitor)}
						className={[
							"group overflow-hidden border text-left transition-colors",
							isSelected
								? "border-line-focus bg-selected"
								: "border-line bg-surface hover:bg-hover",
						].join(" ")}
					>
						<div className="aspect-video overflow-hidden bg-surface-low">
							{previews[key] ? (
								<img
									src={previews[key]}
									alt=""
									className="h-full w-full object-cover"
								/>
							) : (
								<div className="text-faint flex h-full items-center justify-center text-sm">
									Carregando preview...
								</div>
							)}
						</div>

						<div className="border-t border-line px-3 py-2">
							<div className="text-primary truncate text-sm font-medium">
								{monitor.name}
							</div>

							<div className="text-muted mt-0.5 text-xs">
								{monitor.width} × {monitor.height}
								{monitor.is_primary ? " · Principal" : ""}
							</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}

export default ScreenSharePicker;

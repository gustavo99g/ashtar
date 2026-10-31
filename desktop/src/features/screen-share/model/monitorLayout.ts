import type { CaptureSource, MonitorInfo } from "@/lib/tauri/commands";

export interface PlacedMonitor {
	source: CaptureSource;
	monitor: MonitorInfo;
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Encaixa a disposição real das telas (coordenadas do Windows) numa área de
 * `areaWidth` × `areaHeight` px, centralizada, com margem e um vão entre as telas.
 */
export function layoutMonitors(
	sources: CaptureSource[],
	areaWidth: number,
	areaHeight: number,
	padding = 24,
	gap = 4,
): PlacedMonitor[] {
	const screens = sources.flatMap((source) =>
		source.monitor ? [{ source, monitor: source.monitor }] : [],
	);
	if (screens.length === 0) {
		return [];
	}

	const minX = Math.min(...screens.map(({ monitor }) => monitor.x));
	const minY = Math.min(...screens.map(({ monitor }) => monitor.y));
	const maxX = Math.max(
		...screens.map(({ monitor }) => monitor.x + monitor.width),
	);
	const maxY = Math.max(
		...screens.map(({ monitor }) => monitor.y + monitor.height),
	);

	const scale = Math.min(
		(areaWidth - padding * 2) / (maxX - minX),
		(areaHeight - padding * 2) / (maxY - minY),
	);
	const offsetX = (areaWidth - (maxX - minX) * scale) / 2;
	const offsetY = (areaHeight - (maxY - minY) * scale) / 2;

	return screens.map(({ source, monitor }) => ({
		source,
		monitor,
		left: Math.round(offsetX + (monitor.x - minX) * scale + gap),
		top: Math.round(offsetY + (monitor.y - minY) * scale + gap),
		width: Math.round(monitor.width * scale - gap * 2),
		height: Math.round(monitor.height * scale - gap * 2),
	}));
}

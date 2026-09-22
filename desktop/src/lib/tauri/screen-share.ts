import { Channel, invoke } from "@tauri-apps/api/core";

export interface WindowSource {
	id: number;
	title: string;
	process_id: number;
	icon: string | null;
}

export interface MonitorSource {
	id: number;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	is_primary: boolean;
}

export type PreviewSourceType = "window" | "monitor";

export type ScreenShareSelection =
	| {
			type: "window";
			source: WindowSource;
	  }
	| {
			type: "monitor";
			source: MonitorSource;
	  };

export interface WindowPreviewFrame {
	source_id: number;
	source_type: PreviewSourceType;
	mime_type: string;
	data: number[];
}

export function listScreenShareWindows() {
	return invoke<WindowSource[]>("list_screen_share_windows");
}

export function listScreenShareMonitors() {
	return invoke<MonitorSource[]>("list_screen_share_monitors");
}

export function startWindowPreview(
	sourceId: number,
	onFrame: (frame: WindowPreviewFrame) => void,
) {
	const channel = new Channel<WindowPreviewFrame>();

	channel.onmessage = onFrame;

	return invoke<void>("start_window_preview", {
		sourceId,
		channel,
	});
}

export function startMonitorPreview(
	sourceId: number,
	onFrame: (frame: WindowPreviewFrame) => void,
) {
	const channel = new Channel<WindowPreviewFrame>();

	channel.onmessage = onFrame;

	return invoke<void>("start_monitor_preview", {
		sourceId,
		channel,
	});
}

export function stopAllScreenSharePreviews() {
	return invoke<void>("stop_all_screen_share_previews");
}

export function captureWindowSnapshot(sourceId: number) {
	return invoke<WindowPreviewFrame>("capture_window_snapshot", {
		sourceId,
	});
}

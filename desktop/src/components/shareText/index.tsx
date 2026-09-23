import { Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	ackLivekitWindowCapture,
	startLivekitWindowCapture,
	stopLivekitWindowCapture,
} from "@/lib/tauri/commands";
import type { ScreenShareSelection } from "@/lib/tauri/commands";
import ScreenSharePicker from "../voice/screenSharePicker";

export function ScreenShareVideoTest() {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [selection, setSelection] = useState<ScreenShareSelection | null>(null);
	const [capturing, setCapturing] = useState(false);

	const videoRef = useRef<HTMLVideoElement | null>(null);
	const writerRef = useRef<WritableStreamDefaultWriter<VideoFrame> | null>(
		null,
	);

	const receivedFramesRef = useRef(0);
	const renderedFramesRef = useRef(0);
	const droppedFramesRef = useRef(0);
	const displayedFramesRef = useRef(0);
	const processingRef = useRef(false);

	const captureIdRef = useRef<number | null>(null);

	async function start() {
		const source = selection?.source;

		if (!source) {
			return;
		}

		if (selection.type !== "window") {
			return;
		}

		const generator = new MediaStreamTrackGenerator({
			kind: "video",
		});

		const writer = generator.writable.getWriter();

		writerRef.current = writer;

		const stream = new MediaStream([generator]);

		if (videoRef.current) {
			videoRef.current.srcObject = stream;
		}

		const channel = new Channel<ArrayBuffer>();

		channel.onmessage = (payload) => {
			if (processingRef.current) {
				droppedFramesRef.current++;
				return;
			}
			processingRef.current = true;
			void handleFrame(payload).finally(() => {
				processingRef.current = false;
			});
		};

		const captureId = await startLivekitWindowCapture(source.id, channel);

		captureIdRef.current = captureId;
		setCapturing(true);

		console.log("Captura iniciada:", captureId);
	}

	async function handleFrame(payload: ArrayBuffer | Uint8Array) {
		receivedFramesRef.current++;

		const buffer =
			payload instanceof ArrayBuffer
				? payload
				: payload.buffer.slice(
						payload.byteOffset,
						payload.byteOffset + payload.byteLength,
					);

		const view = new DataView(buffer);

		const width = view.getUint32(0, true);
		const height = view.getUint32(4, true);

		// const captureTimestamp = Number(view.getBigUint64(8, true));
		// const sendTimestamp = Number(view.getBigUint64(16, true));

		const chromaWidth = Math.ceil(width / 2);
		const chromaHeight = Math.ceil(height / 2);

		const ySize = width * height;
		const uvSize = chromaWidth * chromaHeight;

		// const now = Date.now() * 1000;

		// const captureToJs = (now - captureTimestamp) / 1000;
		// const sendToJs = (now - sendTimestamp) / 1000;

		// if (receivedFramesRef.current % 30 === 0) {
		// 	console.log(
		// 		`FRAME AGE: capture→JS=${captureToJs.toFixed(2)}ms send→JS=${sendToJs.toFixed(2)}ms`,
		// 	);
		// }

		// const frameStart = performance.now();

		const pixelData = new Uint8Array(buffer, 24);

		const frame = new VideoFrame(pixelData, {
			format: "I420",
			codedWidth: width,
			codedHeight: height,
			timestamp: Math.round(performance.now() * 1000),
			layout: [
				{ offset: 0, stride: width },
				{ offset: ySize, stride: chromaWidth },
				{ offset: ySize + uvSize, stride: chromaWidth },
			],
		});

		// const createTime = performance.now() - frameStart;

		try {
			const writer = writerRef.current;

			if (!writer) {
				return;
			}

			// const writeStart = performance.now();

			const captureId = captureIdRef.current;
			const video = videoRef.current;
			video?.requestVideoFrameCallback(() => {
				displayedFramesRef.current++;
				if (captureId !== null) {
					void ackLivekitWindowCapture(captureId);
				}
			});

			await writer.write(frame);

			// const writeTime = performance.now() - writeStart;

			renderedFramesRef.current++;

			if (captureId !== null) {
				// const ackStart = performance.now();
				// const ackInvokeTime = performance.now() - ackStart;
				// if (receivedFramesRef.current % 10 === 0) {
				// 	console.log("FRAME TIMING", {
				// 		create: createTime.toFixed(2),
				// 		write: writeTime.toFixed(2),
				// 		ackInvoke: ackInvokeTime.toFixed(2),
				// 		total: (createTime + writeTime + ackInvokeTime).toFixed(2),
				// 	});
				// }
			}
		} finally {
			frame.close();
		}
	}
	async function stop() {
		const captureId = captureIdRef.current;

		if (captureId === null) {
			return;
		}

		captureIdRef.current = null;

		await stopLivekitWindowCapture(captureId);

		const writer = writerRef.current;

		if (writer) {
			await writer.close();
		}

		writerRef.current = null;

		if (videoRef.current) {
			videoRef.current.srcObject = null;
		}

		setCapturing(false);
	}

	useEffect(() => {
		return () => {
			void stop();
		};
	}, []);

	// useEffect(() => {
	// 	const interval = window.setInterval(() => {
	// 		console.log("SCREEN SHARE:", {
	// 			received: receivedFramesRef.current,
	// 			rendered: renderedFramesRef.current,
	// 			displayed: displayedFramesRef.current,
	// 			dropped: droppedFramesRef.current,
	// 		});

	// 		receivedFramesRef.current = 0;
	// 		renderedFramesRef.current = 0;
	// 		droppedFramesRef.current = 0;
	// 		displayedFramesRef.current = 0;
	// 	}, 1000);

	// 	return () => {
	// 		window.clearInterval(interval);
	// 	};
	// }, []);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex gap-2">
				<Button onClick={() => setPickerOpen(true)} disabled={capturing}>
					Escolher fonte
				</Button>

				<Button
					variant="secondary"
					disabled={!selection || capturing}
					onClick={() => void start()}
				>
					Iniciar captura
				</Button>

				<Button
					variant="danger"
					disabled={!capturing}
					onClick={() => void stop()}
				>
					Parar captura
				</Button>
			</div>

			{selection && (
				<div className="text-secondary text-sm">
					Selecionado:{" "}
					{selection.type === "window"
						? selection.source.title
						: selection.source.name}
				</div>
			)}

			<div className="aspect-video w-full max-w-4xl bg-black">
				<video
					ref={videoRef}
					className="h-full w-full object-contain"
					autoPlay
					muted
					playsInline
				/>
			</div>

			<ScreenSharePicker
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				onConfirm={(nextSelection) => {
					setSelection(nextSelection);
					setPickerOpen(false);
				}}
			/>
		</div>
	);
}

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { ScreenShareAudio } from "@/lib/audio";

export function AudioTest() {
	const audioRef = useRef<ScreenShareAudio | null>(null);

	async function start() {
		const audio = await ScreenShareAudio.create();

		audioRef.current = audio;

		await audio.start({
			mode: "application",
			processId: 8252,
		});
	}

	async function stop() {
		await audioRef.current?.stop();
		audioRef.current = null;
	}

	return (
		<div className="flex gap-2">
			<Button onClick={start}>Iniciar áudio</Button>

			<Button variant="secondary" onClick={stop}>
				Parar áudio
			</Button>
		</div>
	);
}

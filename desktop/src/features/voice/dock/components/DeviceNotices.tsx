import { MicIcon, MicOffIcon, SpeakerIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { NoticeIcon } from "../../call/components/NoticeIcon";
import { useAudioDevices } from "../../devices/hooks/useAudioDevices";
import {
	type DeviceNotice,
	type DeviceStatus,
	deviceNotices,
} from "../../devices/model/deviceNotices";
import {
	type AudioDevices,
	type DeviceKind,
	isMissing,
	knownDevices,
} from "../../devices/model/devices";
import { useDeviceChoice } from "../../devices/stores/deviceChoiceStore";
import { useVoice } from "../../room/hooks/useVoice";

const NAMES: Record<DeviceKind, { title: string; fallback: string }> = {
	input: {
		title: "Seu microfone foi desconectado",
		fallback: "Usando o microfone padrão do Windows",
	},
	output: {
		title: "Sua saída de áudio foi desconectada",
		fallback: "Usando a saída padrão do Windows",
	},
};

/**
 * Os avisos dos dispositivos na chamada (quadro "Aviso — dispositivo desconectado"): o escolhido
 * sumiu, e a chamada já passou para o padrão do Windows; quando ele volta, o aviso some. E, para quem
 * entrou sem microfone, o aviso de quando um aparece, com Ativar. Não desenha nada.
 */
export function DeviceNotices() {
	const devices = useAudioDevices();
	const input = useDeviceChoice((state) => state.input);
	const output = useDeviceChoice((state) => state.output);
	const { error, unmute } = useVoice();
	/** Para o Ativar ler na hora, sem refazer a escuta. */
	const latest = useRef({ error, unmute });
	latest.current = { error, unmute };

	const previous = useRef<DeviceStatus | null>(null);
	const shown = useRef<Partial<Record<DeviceKind, string>>>({});

	useEffect(() => {
		// A primeira leitura é o ponto de partida: entrar com o fone já desligado não avisa.
		if (devices === null) return;
		const status: DeviceStatus = {
			missing: {
				input: isMissing(input, knownDevices(devices, "input")),
				output: isMissing(output, knownDevices(devices, "output")),
			},
			inputs: knownDevices(devices, "input")?.length ?? null,
		};
		const before = previous.current;
		previous.current = status;
		if (!before) return;
		for (const notice of deviceNotices(before, status)) {
			// Só para quem está sem microfone por não ter nenhum, e não para quem mutou.
			if (
				notice.kind === "microphoneFound" &&
				latest.current.error?.kind !== "microphone"
			) {
				continue;
			}
			show(notice, devices, shown.current, () => void latest.current.unmute());
		}
	}, [devices, input, output]);

	// O microfone não abriu (nenhum, ou sem permissão): a pessoa fica na sala, mutada.
	const microphoneProblem = error?.kind === "microphone" ? error.message : null;
	useEffect(() => {
		if (microphoneProblem === null) return;
		const id = toast.add({
			title: "Microfone indisponível",
			description: microphoneProblem,
			data: {
				tone: "warning",
				media: (
					<NoticeIcon tone="warning">
						<MicOffIcon />
					</NoticeIcon>
				),
			},
		});
		return () => toast.close(id);
	}, [microphoneProblem]);

	useEffect(
		() => () => {
			for (const id of Object.values(shown.current)) toast.close(id);
		},
		[],
	);

	return null;
}

function show(
	notice: DeviceNotice,
	devices: AudioDevices,
	shown: Partial<Record<DeviceKind, string>>,
	activate: () => void,
) {
	switch (notice.kind) {
		case "missing": {
			const name = devices.defaults[notice.device];
			const { title, fallback } = NAMES[notice.device];
			shown[notice.device] = toast.add({
				title,
				description: name ? `Usando o padrão do Windows: ${name}` : fallback,
				data: {
					tone: "warning",
					media: (
						<NoticeIcon tone="warning">
							{notice.device === "input" ? <MicOffIcon /> : <SpeakerIcon />}
						</NoticeIcon>
					),
				},
			});
			return;
		}
		case "back": {
			const id = shown[notice.device];
			if (id) toast.close(id);
			delete shown[notice.device];
			return;
		}
		case "microphoneFound": {
			const id = toast.add({
				title: "Um microfone foi conectado",
				description: "Você entrou sem microfone e continua mutado.",
				data: {
					tone: "info",
					media: (
						<NoticeIcon tone="info">
							<MicIcon />
						</NoticeIcon>
					),
				},
				actionProps: {
					children: "Ativar microfone",
					onClick: () => {
						toast.close(id);
						activate();
					},
				},
			});
		}
	}
}

import { UnplugIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { setSuppression, useNoiseChoice } from "../../noise/stores/noiseStore";
import { useAudioDevices } from "../hooks/useAudioDevices";
import {
	type AudioDevice,
	type AudioDevices,
	type DeviceKind,
	isMissing,
	knownDevices,
} from "../model/devices";
import { chooseDevice, useDeviceChoice } from "../stores/deviceChoiceStore";

/*
 * Configurações › Voz e vídeo (quadro "Configurações — voz e vídeo"). O bloco Dispositivos (a
 * entrada e a saída) e, desde a 0.2.3, a Supressão de ruído do bloco Processamento de voz. O resto
 * do quadro (eco, ganho, modo de entrada, tela) fica para a v0.2.5 e a v0.6 (BACKLOG).
 *
 * A escolha vale na hora, também no meio de uma chamada (`VoiceProvider`). Um dispositivo escolhido
 * que está desconectado continua escolhido, apagado e com "(desconectado)", e o aviso embaixo diz
 * o que vale enquanto isso: o padrão do Windows, até ele voltar.
 */

/** O valor do "Padrão do Windows" no seletor. A lista não tem o "default" do WebView2. */
const SYSTEM = "default";
const SYSTEM_NAME = "Padrão do Windows";

const MISSING = "(desconectado)";

interface Option {
	value: string;
	label: string;
	disabled?: boolean;
}

export function VoiceSettings() {
	const devices = useAudioDevices({ revealNames: true });

	return (
		<div className="@container flex w-full flex-col gap-9 py-20 pr-28 pl-32">
			<h1 className="text-[22px] leading-tight font-bold text-foreground">
				Voz e vídeo
			</h1>
			<Section title="Dispositivos">
				<div className="grid gap-5 @xl:grid-cols-2">
					<DevicePicker kind="input" label="Entrada" devices={devices} />
					<DevicePicker kind="output" label="Saída" devices={devices} />
				</div>
			</Section>
			<Section title="Processamento de voz">
				<NoiseSwitch />
			</Section>
		</div>
	);
}

/** Ligada: o RNNoise. Desligada: a supressão do navegador, como antes. Vale na hora. */
function NoiseSwitch() {
	const labelId = useId();
	const suppression = useNoiseChoice((state) => state.suppression);
	return (
		<div className="flex items-center justify-between gap-6 border-b border-border py-3">
			<span className="flex flex-col gap-[3px]">
				<span id={labelId} className="text-sm font-medium text-foreground">
					Supressão de ruído
				</span>
				<span className="text-xs text-muted-foreground">
					Reduz sons de fundo como teclado e ventilador.
				</span>
			</span>
			<Switch
				checked={suppression}
				onCheckedChange={setSuppression}
				aria-labelledby={labelId}
				variant={"blue"}
			/>
		</div>
	);
}

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

/** O nome que o Windows dá; sem ele (o WebView2 escondeu), um número. */
function deviceName(device: AudioDevice, index: number): string {
	return device.label || `Dispositivo ${index + 1}`;
}

function DevicePicker({
	kind,
	label,
	devices,
}: {
	kind: DeviceKind;
	label: string;
	devices: AudioDevices | null;
}) {
	const hintId = useId();
	const chosen = useDeviceChoice((state) => state[kind]);
	const list = devices?.[kind] ?? [];
	const missing = isMissing(chosen, knownDevices(devices, kind));
	const systemDevice = devices?.defaults[kind] ?? null;

	const options: Option[] = [
		{ value: SYSTEM, label: SYSTEM_NAME },
		...list.map((device, index) => ({
			value: device.id,
			label: deviceName(device, index),
		})),
	];
	// O escolhido fora da lista continua nela, apagado, para o seletor mostrar qual é.
	const chosenName = chosen?.label || "Dispositivo escolhido";
	if (chosen && !list.some((device) => device.id === chosen.id)) {
		options.push({
			value: chosen.id,
			label: missing ? `${chosenName} ${MISSING}` : chosenName,
			disabled: true,
		});
	}

	function choose(value: string | null) {
		if (value === null || value === SYSTEM) {
			chooseDevice(kind, null);
			return;
		}
		const device = list.find((item) => item.id === value);
		if (device) chooseDevice(kind, device);
	}

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<Select
				items={options}
				value={chosen?.id ?? SYSTEM}
				onValueChange={choose}
			>
				<SelectLabel>{label}</SelectLabel>
				<SelectTrigger aria-describedby={missing ? hintId : undefined}>
					<SelectValue>
						{(value: string) => {
							if (value === SYSTEM) return <SystemName device={systemDevice} />;
							// Um nome longo corta antes do "(desconectado)", que fica sempre à vista.
							if (missing) {
								return (
									<span className="flex min-w-0">
										<span className="truncate">{chosenName}</span>
										<span className="shrink-0 whitespace-pre"> {MISSING}</span>
									</span>
								);
							}
							return options.find((option) => option.value === value)?.label;
						}}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem
							key={option.value}
							value={option.value}
							label={option.label}
							disabled={option.disabled}
						>
							{option.value === SYSTEM ? (
								<SystemName device={systemDevice} />
							) : (
								option.label
							)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{missing && (
				<p
					id={hintId}
					className="flex items-start gap-1.5 text-xs leading-snug text-warning-text"
				>
					<UnplugIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
					<span>
						Desconectado. Até ele voltar, o Ashtar usa o padrão do Windows
						{systemDevice ? `: ${systemDevice}.` : "."}
					</span>
				</p>
			)}
		</div>
	);
}

/** "Padrão do Windows", com o dispositivo que ele é agora, quando se sabe. */
function SystemName({ device }: { device: string | null }) {
	return (
		<>
			{SYSTEM_NAME}
			{device && <span className="text-muted-foreground"> · {device}</span>}
		</>
	);
}

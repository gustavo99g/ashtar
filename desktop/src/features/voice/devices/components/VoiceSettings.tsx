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
import { ShareDefaultsSection } from "@/features/screen-share";
import { useSettingsStore } from "@/features/settings";
import { cn } from "@/lib/utils";
import { CameraOptions } from "../../camera/components/CameraOptions";
import {
	setInputChoice,
	setSuppression,
	useInputChoice,
} from "../../input/stores/inputStore";
import { useAudioDevices } from "../hooks/useAudioDevices";
import {
	type AudioDevice,
	type AudioDevices,
	type DeviceKind,
	isMissing,
	knownDevices,
} from "../model/devices";
import { chooseDevice, useDeviceChoice } from "../stores/deviceChoiceStore";
import {
	setOutputVolume,
	useOutputVolume,
} from "../stores/outputVolumeStore";
import { InputModeSection } from "./InputModeSection";
import { MicTest } from "./MicTest";
import { SettingSwitch } from "./SettingSwitch";
import { VolumeSlider } from "./VolumeSlider";

/*
 * Configurações › Voz e vídeo (quadro "Configurações — voz e vídeo", ADR 0029): os dispositivos
 * com o volume de entrada e de saída e o Testar microfone; o modo de entrada (a detecção de voz com
 * a sensibilidade, ou o pressionar para falar); o processamento de voz; a câmera; o padrão do
 * compartilhamento de tela; e as perguntas das ligações.
 *
 * Tudo vale na hora, também no meio de uma chamada (`VoiceProvider`). Um dispositivo escolhido
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
	// O "Ligar para fulano?" (v0.3) e o "Trocar de sala?" (v0.5): o "Não perguntar de novo" do
	// próprio aviso desliga; aqui liga de volta.
	const askBeforeCall = useSettingsStore((state) => state.askBeforeCall);
	const setAskBeforeCall = useSettingsStore((state) => state.setAskBeforeCall);
	const askBeforeSwitchRoom = useSettingsStore(
		(state) => state.askBeforeSwitchRoom,
	);
	const setAskBeforeSwitchRoom = useSettingsStore(
		(state) => state.setAskBeforeSwitchRoom,
	);
	const choice = useInputChoice();
	const outputVolume = useOutputVolume((state) => state.volume);

	return (
		<div className="@container flex w-full flex-col gap-9 py-20 pr-28 pl-32">
			<h1 className="text-[22px] leading-tight font-bold text-foreground">
				Voz e vídeo
			</h1>
			<Section title="Dispositivos">
				<div className="grid gap-5 @xl:grid-cols-2">
					<DevicePicker kind="input" label="Entrada" devices={devices}>
						<VolumeSlider
							label="Volume de entrada"
							value={choice.volume}
							onChange={(volume) => setInputChoice({ volume })}
						/>
					</DevicePicker>
					<DevicePicker kind="output" label="Saída" devices={devices}>
						<VolumeSlider
							label="Volume de saída"
							value={outputVolume}
							onChange={setOutputVolume}
						/>
					</DevicePicker>
				</div>
				<MicTest />
			</Section>
			<Section title="Modo de entrada">
				<InputModeSection />
			</Section>
			<Section title="Processamento de voz" gap="gap-1">
				<SettingSwitch
					title="Supressão de ruído"
					description="Reduz sons de fundo como teclado e ventilador."
					checked={choice.suppression}
					onCheckedChange={setSuppression}
				/>
				<SettingSwitch
					title="Cancelamento de eco"
					description="Evita que o som dos alto-falantes volte pelo microfone."
					checked={choice.echoCancellation}
					onCheckedChange={(echoCancellation) =>
						setInputChoice({ echoCancellation })
					}
				/>
				<SettingSwitch
					title="Controle automático de ganho"
					description="Mantém o volume da sua voz estável."
					checked={choice.autoGainControl}
					onCheckedChange={(autoGainControl) =>
						setInputChoice({ autoGainControl })
					}
				/>
				<SettingSwitch
					title="Avisar quando falo mutado"
					description="Mostra “Você está mutado” no painel de voz quando você fala com o microfone desligado."
					checked={choice.warnWhenMuted}
					onCheckedChange={(warnWhenMuted) => setInputChoice({ warnWhenMuted })}
				/>
			</Section>
			<Section title="Câmera">
				<CameraOptions className="max-w-[420px]" />
			</Section>
			<Section title="Compartilhamento de tela">
				<ShareDefaultsSection />
			</Section>
			<Section title="Ligações" gap="gap-1">
				<SettingSwitch
					title="Perguntar antes de ligar estando numa sala"
					description="A ligação tira você da sala quando a outra pessoa atende."
					checked={askBeforeCall}
					onCheckedChange={setAskBeforeCall}
				/>
				<SettingSwitch
					title="Perguntar antes de trocar de sala transmitindo"
					description="Trocar de sala encerra a sua transmissão e desliga a câmera."
					checked={askBeforeSwitchRoom}
					onCheckedChange={setAskBeforeSwitchRoom}
				/>
			</Section>
		</div>
	);
}

function Section({
	title,
	gap = "gap-4",
	children,
}: {
	title: string;
	gap?: string;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<section aria-labelledby={id} className={cn("flex flex-col", gap)}>
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
	children,
}: {
	kind: DeviceKind;
	label: string;
	devices: AudioDevices | null;
	children?: ReactNode;
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
			{children}
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

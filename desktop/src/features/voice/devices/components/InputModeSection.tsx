import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { type ReactNode, useId } from "react";
import { Switch } from "@/components/ui/switch";
import { useInputLevel } from "../../input/hooks/useInputLevel";
import type { InputMode } from "../../input/model/gate";
import { setInputChoice, useInputChoice } from "../../input/stores/inputStore";
import { SensitivityBar } from "./SensitivityBar";

/**
 * O modo de entrada (quadro "Configurações — voz e vídeo"): os dois cartões, e o bloco da
 * sensibilidade na detecção de voz. O atalho do pressionar para falar entra aqui na Etapa 4.
 */
export function InputModeSection({ children }: { children?: ReactNode }) {
	const mode = useInputChoice((state) => state.mode);
	return (
		<>
			<RadioGroup
				aria-label="Modo de entrada"
				value={mode}
				onValueChange={(next) => setInputChoice({ mode: next as InputMode })}
				className="grid gap-3 @xl:grid-cols-2"
			>
				<ModeCard
					value="voice"
					title="Detecção de voz"
					description="O microfone transmite quando você fala acima da sensibilidade."
				/>
				<ModeCard
					value="ptt"
					title="Pressionar para falar"
					description="Só transmite enquanto o atalho estiver pressionado."
				/>
			</RadioGroup>
			{children}
			{mode === "voice" && <Sensitivity />}
		</>
	);
}

function ModeCard({
	value,
	title,
	description,
}: {
	value: InputMode;
	title: string;
	description: string;
}) {
	return (
		<Radio.Root
			value={value}
			className="group/mode flex cursor-pointer items-start gap-3 rounded-[10px] border-2 border-border bg-card px-4 py-3.5 text-left transition-colors select-none hover:border-ring/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-checked:border-ring"
		>
			<span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 border-foreground-subtle group-data-checked/mode:border-ring">
				<Radio.Indicator className="size-2 rounded-full bg-primary" />
			</span>
			<span className="flex flex-col gap-1">
				<span className="text-sm font-semibold text-foreground">{title}</span>
				<span className="text-xs leading-[1.45] text-muted-foreground">
					{description}
				</span>
			</span>
		</Radio.Root>
	);
}

function Sensitivity() {
	const labelId = useId();
	const auto = useInputChoice((state) => state.autoSensitivity);
	const thresholdDb = useInputChoice((state) => state.thresholdDb);
	const level = useInputLevel();
	return (
		<div className="flex flex-col gap-2.5 rounded-[10px] bg-card p-4">
			<div className="flex items-center justify-between gap-6">
				<span id={labelId} className="text-sm font-medium text-foreground">
					Ajustar sensibilidade automaticamente
				</span>
				<Switch
					checked={auto}
					onCheckedChange={(next) => setInputChoice({ autoSensitivity: next })}
					aria-labelledby={labelId}
					variant={"blue"}
				/>
			</div>
			<SensitivityBar
				level={level}
				auto={auto}
				thresholdDb={thresholdDb}
				onThresholdChange={(next) => setInputChoice({ thresholdDb: next })}
			/>
			<span className="text-xs text-muted-foreground">
				{auto
					? "A marca dourada indica o limite a partir do qual sua voz é transmitida."
					: "Arraste a marca dourada: sua voz é transmitida quando passa dela."}
			</span>
		</div>
	);
}

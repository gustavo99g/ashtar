import { XIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { useShortcutRecorder } from "../hooks/useShortcutRecorder";
import { SHORTCUT_NAMES, type ShortcutId } from "../model/shortcuts";
import {
	restoreShortcuts,
	setShortcut,
	useShortcuts,
} from "../stores/shortcutStore";
import { ShortcutKeys } from "./ShortcutKeys";

/*
 * Configurações › Atalhos (quadro "Configurações — atalhos", ADR 0029): Voz e Ligações, cada linha
 * com as teclas, Trocar (ou Definir) e o X para tirar. Funcionam com qualquer janela em foco, pelo
 * gancho do Rust; aqui só se escolhe.
 */

const DESCRIPTIONS: Partial<Record<ShortcutId, string>> = {
	ptt: "Segurando, seu microfone abre. Vale com o modo Pressionar para falar, em Voz e vídeo.",
};

export function ShortcutsSettings() {
	const recorder = useShortcutRecorder();
	return (
		<div className="flex w-full flex-col gap-7 py-20 pr-28 pl-32">
			<div className="flex items-end justify-between gap-5">
				<div className="flex flex-col gap-1.5">
					<h1 className="text-[22px] leading-tight font-bold text-foreground">
						Atalhos
					</h1>
					<span className="text-[13px] text-muted-foreground">
						Funcionam em qualquer lugar, mesmo com o Ashtar minimizado ou atrás
						de um jogo.
					</span>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="shrink-0 text-[13px] font-medium text-foreground"
					onClick={() => {
						recorder.cancel();
						restoreShortcuts();
					}}
				>
					Restaurar padrões
				</Button>
			</div>
			<Group title="Voz">
				{(["mute", "deafen", "ptt"] as const).map((id) => (
					<ShortcutRow key={id} id={id} recorder={recorder} />
				))}
			</Group>
			<Group title="Ligações">
				{(["answer", "decline"] as const).map((id) => (
					<ShortcutRow key={id} id={id} recorder={recorder} />
				))}
			</Group>
		</div>
	);
}

function Group({ title, children }: { title: string; children: ReactNode }) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<h2
				id={id}
				className="text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase"
			>
				{title}
			</h2>
			<div className="rounded-[10px] border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
				{children}
			</div>
		</section>
	);
}

type Recorder = ReturnType<typeof useShortcutRecorder>;

function ShortcutRow({ id, recorder }: { id: ShortcutId; recorder: Recorder }) {
	const shortcut = useShortcuts((state) => state[id]);
	const name = SHORTCUT_NAMES[id];
	const recording = recorder.recording === id;
	const description = DESCRIPTIONS[id];
	return (
		<div className="flex items-center justify-between gap-5 px-[18px] py-3.5">
			<span className="flex min-w-0 flex-col gap-[3px]">
				<span className="text-sm font-semibold text-foreground">{name}</span>
				{recording && recorder.conflict ? (
					<span role="alert" className="text-xs text-warning-text">
						Já é o atalho de {SHORTCUT_NAMES[recorder.conflict]}. Aperte outra
						combinação.
					</span>
				) : (
					description && (
						<span className="text-xs leading-normal text-muted-foreground">
							{description}
						</span>
					)
				)}
			</span>
			<RecorderControls
				id={id}
				name={name}
				recorder={recorder}
				label={shortcut?.label ?? null}
				onRemove={() => setShortcut(id, null)}
			/>
		</div>
	);
}

/** As teclas (ou "Nenhum"), Trocar ou Definir, e o X. Gravando: o convite e o Cancelar. */
export function RecorderControls({
	id,
	name,
	recorder,
	label,
	onRemove,
	setLabel = label ? "Trocar" : "Definir",
}: {
	id: ShortcutId;
	name: string;
	recorder: Recorder;
	label: string | null;
	onRemove?: () => void;
	setLabel?: string;
}) {
	if (recorder.recording === id) {
		return (
			<span className="flex shrink-0 items-center gap-2">
				<span
					role="status"
					className="animate-pulse rounded-[5px] border border-ring px-2.5 py-[3px] text-xs text-foreground"
				>
					Aperte a combinação…
				</span>
				<Button
					variant="outline"
					size="sm"
					className="text-[13px] font-medium text-foreground"
					onClick={recorder.cancel}
				>
					Cancelar
				</Button>
				<span className="w-7" />
			</span>
		);
	}
	return (
		<span className="flex shrink-0 items-center gap-2">
			{label ? (
				<ShortcutKeys label={label} />
			) : (
				<span className="text-xs text-foreground-subtle">Nenhum</span>
			)}
			<Button
				variant="outline"
				size="sm"
				className="text-[13px] font-medium text-foreground"
				aria-label={`${setLabel} atalho de ${name}`}
				onClick={() => recorder.start(id)}
			>
				{setLabel}
			</Button>
			{onRemove &&
				(label ? (
					<button
						type="button"
						aria-label={`Remover atalho de ${name}`}
						title="Remover"
						onClick={onRemove}
						className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
					>
						<XIcon aria-hidden="true" className="size-4" />
					</button>
				) : (
					<span className="w-7" />
				))}
		</span>
	);
}

/**
 * O atalho do pressionar para falar em Voz e vídeo (quadro "Configurações — voz e vídeo"): as
 * teclas e Gravar atalho, com a mesma gravação da tela Atalhos.
 */
export function PushToTalkShortcut({ active }: { active: boolean }) {
	const recorder = useShortcutRecorder();
	const shortcut = useShortcuts((state) => state.ptt);
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-center gap-3">
				<span className="text-[13px] text-muted-foreground">
					Atalho do pressionar para falar
				</span>
				<RecorderControls
					id="ptt"
					name={SHORTCUT_NAMES.ptt}
					recorder={recorder}
					label={shortcut?.label ?? null}
					setLabel="Gravar atalho"
				/>
				<span className="text-xs text-muted-foreground">
					Funciona mesmo com um jogo em foco.
				</span>
			</div>
			{recorder.conflict && (
				<span role="alert" className="text-xs text-warning-text">
					Já é o atalho de {SHORTCUT_NAMES[recorder.conflict]}. Aperte outra
					combinação.
				</span>
			)}
			{active && !shortcut && recorder.recording !== "ptt" && (
				<span role="alert" className="text-xs text-warning-text">
					Sem um atalho, o microfone não abre. Grave um para falar.
				</span>
			)}
		</div>
	);
}

import { CrownIcon, MusicIcon, UploadIcon } from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { useOptionalMe } from "@/features/identity";
import { fetchFile, type Sound } from "@/lib/api";
import { nameFromFile, soundFileProblem } from "../model/audio";
import { useMySounds, usePendingSoundList } from "../queries";
import { usePendingSounds, useSounds } from "../stores/soundsStore";
import { type EditorSource, SoundEditor } from "./SoundEditor";
import { AllSoundList, MySoundList, PendingSoundList } from "./SoundLists";

/*
 * Configurações › Servidor › Sons (v0.9, decisão 21): "Meus sons" para quem envia; "Aprovação" (com
 * o contador dourado) e "Todos os sons" para quem tem "Aprovar sons". O "Carregar som" abre o
 * arquivo no editor; arrastar um arquivo de som em qualquer lugar da tela faz o mesmo.
 */

/** Os mesmos limites da API, para avisar antes. */
export const SOUNDS_MAX = 50;
export const PENDING_PER_PERSON = 3;

type Tab = "mine" | "queue" | "all";

export function SoundSettings() {
	const me = useOptionalMe();
	const canApprove = me?.can_approve_sounds === true;
	const canSend = me?.can_send_sounds === true;
	const [tab, setTab] = useState<Tab>("mine");
	const [source, setSource] = useState<EditorSource | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const dragging = useWindowDrop(canSend, (file) => open(file));
	const pending = usePendingSounds();

	function open(file: File) {
		const problem = soundFileProblem(file);
		if (problem) {
			toast.add({
				title: "Esse arquivo não serve",
				description: problem,
				data: { tone: "error" },
			});
			return;
		}
		setTab("mine");
		setSource({
			blob: file,
			fileName: file.name,
			name: nameFromFile(file.name),
			emoji: null,
		});
	}

	function choose(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (file) open(file);
	}

	async function edit(sound: Sound) {
		try {
			const blob = await fetchFile(sound.file_id);
			setTab("mine");
			setSource({
				blob,
				fileName: `${sound.name}.wav`,
				name: sound.name,
				emoji: sound.emoji,
				replaces: sound.id,
			});
		} catch {
			toast.add({
				title: "Não deu para abrir o som",
				description: "Tente de novo em instantes.",
				data: { tone: "error" },
			});
		}
	}

	return (
		<div className="relative flex w-full flex-col gap-6 py-20 pr-28 pl-32">
			<div className="flex items-end gap-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h1 className="text-[22px] leading-tight font-bold text-foreground">
						Sons
					</h1>
					<p className="text-[13px] text-muted-foreground">
						{tab === "queue"
							? "Sons que o pessoal mandou e estão esperando você."
							: canApprove
								? "Os sons do soundboard. Os que você envia entram direto."
								: "Mande sons para o grupo. Eles aparecem para todo mundo depois de aprovados."}
					</p>
				</div>
				{canSend && (
					<Button onClick={() => input.current?.click()}>
						<UploadIcon className="size-4" />
						Carregar som
					</Button>
				)}
				<input
					ref={input}
					type="file"
					accept="audio/*,.mp3,.ogg,.wav"
					aria-label="Escolher o arquivo de som"
					className="hidden"
					onChange={choose}
				/>
			</div>

			<Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
				{canApprove && (
					<TabsList className="w-full gap-6 rounded-none border-0 border-b border-border bg-transparent p-0">
						<UnderTab value="mine">Meus sons</UnderTab>
						<UnderTab value="queue">
							Aprovação
							{pending > 0 && (
								<span className="flex size-[18px] items-center justify-center rounded-full bg-gold text-[11px] font-bold text-gold-foreground">
									{pending}
								</span>
							)}
							<CrownIcon aria-hidden="true" className="size-3 text-gold" />
						</UnderTab>
						<UnderTab value="all">
							Todos os sons
							<CrownIcon aria-hidden="true" className="size-3 text-gold" />
						</UnderTab>
					</TabsList>
				)}
				<TabsContent value="mine" className="flex flex-col gap-5">
					{source && (
						<SoundEditor
							key={`${source.fileName}:${source.replaces ?? ""}`}
							source={source}
							direct={canApprove}
							onDone={() => setSource(null)}
						/>
					)}
					<MineTab canSend={canSend} onEdit={edit} />
				</TabsContent>
				{canApprove && (
					<>
						<TabsContent value="queue" className="flex flex-col gap-4">
							<QueueTab />
						</TabsContent>
						<TabsContent value="all" className="flex flex-col gap-4">
							<AllTab />
						</TabsContent>
					</>
				)}
			</Tabs>

			{dragging && (
				<div
					aria-hidden="true"
					className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gold bg-background/85"
				>
					<span className="flex size-16 items-center justify-center rounded-full bg-gold-subtle text-gold">
						<UploadIcon className="size-7" />
					</span>
					<span className="text-lg font-semibold text-foreground">
						Solte para carregar o som
					</span>
					<span className="text-[13px] text-muted-foreground">
						MP3, OGG ou WAV. Se passar de 5 s, você corta no editor.
					</span>
				</div>
			)}
		</div>
	);
}

function UnderTab({ value, children }: { value: Tab; children: ReactNode }) {
	return (
		<TabsTrigger
			value={value}
			className="h-10 rounded-none border-b-2 border-transparent px-1 text-sm data-active:border-primary data-active:bg-transparent data-active:font-semibold data-active:text-foreground"
		>
			{children}
		</TabsTrigger>
	);
}

/** Um arquivo arrastado por cima da janela inteira: `true` enquanto está em cima. */
function useWindowDrop(enabled: boolean, onFile: (file: File) => void): boolean {
	const [over, setOver] = useState(false);
	const latest = useRef(onFile);
	latest.current = onFile;
	useEffect(() => {
		if (!enabled) return;
		let depth = 0;
		const hasFile = (event: DragEvent) =>
			event.dataTransfer?.types.includes("Files") === true;
		const enter = (event: DragEvent) => {
			if (!hasFile(event)) return;
			depth += 1;
			setOver(true);
		};
		const leave = (event: DragEvent) => {
			if (!hasFile(event)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setOver(false);
		};
		const overHandler = (event: DragEvent) => {
			if (hasFile(event)) event.preventDefault();
		};
		const drop = (event: DragEvent) => {
			if (!hasFile(event)) return;
			event.preventDefault();
			depth = 0;
			setOver(false);
			const file = event.dataTransfer?.files[0];
			if (file) latest.current(file);
		};
		window.addEventListener("dragenter", enter);
		window.addEventListener("dragleave", leave);
		window.addEventListener("dragover", overHandler);
		window.addEventListener("drop", drop);
		return () => {
			window.removeEventListener("dragenter", enter);
			window.removeEventListener("dragleave", leave);
			window.removeEventListener("dragover", overHandler);
			window.removeEventListener("drop", drop);
		};
	}, [enabled]);
	return over;
}

function SectionHeader({ title, aside }: { title: string; aside?: string }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<h2 className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
				{title}
			</h2>
			{aside && (
				<span className="font-mono text-xs text-muted-foreground">{aside}</span>
			)}
		</div>
	);
}

function MineTab({
	canSend,
	onEdit,
}: {
	canSend: boolean;
	onEdit: (sound: Sound) => void;
}) {
	const query = useMySounds();
	if (query.isPending) return <LoadingState className="py-16" />;
	const sounds = query.data ?? [];
	const waiting = sounds.filter((sound) => sound.status === "pending").length;
	return (
		<>
			<SectionHeader
				title="Enviados por você"
				aside={`${waiting} de ${PENDING_PER_PERSON} aguardando`}
			/>
			{sounds.length === 0 ? (
				<EmptyState
					className="rounded-xl border border-dashed border-border-strong py-14"
					icon={<MusicIcon />}
					title="Nenhum som enviado ainda"
					description={
						canSend
							? "Arraste um arquivo de som para cá ou use Carregar som."
							: "Você não tem permissão para enviar sons."
					}
				/>
			) : (
				<MySoundList sounds={sounds} onEdit={onEdit} />
			)}
		</>
	);
}

function QueueTab() {
	const query = usePendingSoundList(true);
	const total = useSounds().length;
	if (query.isPending) return <LoadingState className="py-16" />;
	const sounds = query.data ?? [];
	return (
		<>
			<SectionHeader
				title="Aguardando aprovação"
				aside={`${sounds.length} ${sounds.length === 1 ? "som" : "sons"} · ${total} de ${SOUNDS_MAX} no grupo`}
			/>
			{sounds.length === 0 ? (
				<EmptyState
					className="rounded-xl border border-dashed border-border-strong py-14"
					icon={<MusicIcon />}
					title="Nada esperando"
					description="Os sons que o pessoal enviar aparecem aqui."
				/>
			) : (
				<PendingSoundList sounds={sounds} />
			)}
			<p className="text-xs text-muted-foreground">
				Quem enviou recebe um aviso quando o som é aprovado ou recusado. Sons que você
				envia entram direto, sem passar por aqui.
			</p>
		</>
	);
}

function AllTab() {
	const sounds = useSounds();
	return (
		<>
			<SectionHeader
				title="Sons do grupo"
				aside={`${sounds.length} de ${SOUNDS_MAX}`}
			/>
			{sounds.length === 0 ? (
				<EmptyState
					className="rounded-xl border border-dashed border-border-strong py-14"
					icon={<MusicIcon />}
					title="Nenhum som aprovado"
					description="Os sons aprovados aparecem aqui e na grade de Sons da voz."
				/>
			) : (
				<AllSoundList sounds={sounds} />
			)}
		</>
	);
}

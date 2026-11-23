import { AppWindowIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	type CaptureSource,
	activityWindows,
	addGame,
	listCaptureSources,
	type WindowGame,
} from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";

/** Uma janela aberta, com o `.exe` e, se já for jogo, o nome. */
export interface WindowChoice {
	id: number;
	title: string;
	icon: string | null;
	exe: string | null;
	recognized: string | null;
}

/** Junta a lista do seletor com o que o Rust sabe de cada janela; sem `.exe`, fica de fora. */
export function windowChoices(
	sources: CaptureSource[],
	games: WindowGame[],
): WindowChoice[] {
	const byId = new Map(games.map((game) => [game.id, game]));
	return sources.flatMap((source) => {
		if (source.source.kind !== "window") return [];
		const game = byId.get(source.source.id);
		if (!game?.exe) return [];
		return [
			{
				id: source.source.id,
				title: source.title,
				icon: source.icon,
				exe: game.exe,
				recognized: game.recognized,
			},
		];
	});
}

/** O nome do `.exe`, sem a pasta e sem a extensão: o nome sugerido. */
function exeName(exe: string): string {
	const file = exe.split(/[\\/]/).pop() ?? exe;
	return file.replace(/\.exe$/i, "");
}

type Loaded =
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; choices: WindowChoice[] };

/**
 * "Adicionar jogo": as janelas abertas (a mesma lista do seletor, com o ícone e o `.exe`). A que já
 * é reconhecida aparece apagada. Escolher uma deixa trocar o nome e guarda o `.exe`.
 */
export function AddGameDialog({
	open,
	onClose,
	onAdded,
}: {
	open: boolean;
	onClose: () => void;
	onAdded: () => void;
}) {
	const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
	const [selected, setSelected] = useState<WindowChoice | null>(null);
	const [name, setName] = useState("");
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		let active = true;
		setLoaded({ status: "loading" });
		setSelected(null);
		setName("");
		setFailure(null);
		void (async () => {
			const sources = await listCaptureSources();
			const ids = sources.flatMap((source) =>
				source.source.kind === "window" ? [source.source.id] : [],
			);
			const games = await activityWindows(ids);
			if (active)
				setLoaded({ status: "ready", choices: windowChoices(sources, games) });
		})().catch(() => {
			if (active) setLoaded({ status: "error" });
		});
		return () => {
			active = false;
		};
	}, [open]);

	async function add() {
		if (!selected || !name.trim()) return;
		try {
			await addGame(selected.id, name.trim());
			onAdded();
			onClose();
		} catch (error) {
			setFailure(
				typeof error === "object" && error !== null && "message" in error
					? String(error.message)
					: String(error),
			);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="max-w-[520px]">
				<DialogTitle>Adicionar jogo</DialogTitle>
				<DialogDescription>
					Abra o jogo e escolha a janela dele. O Ashtar guarda o programa e passa
					a reconhecer o jogo sempre que ele abrir.
				</DialogDescription>
				<div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
					{loaded.status === "loading" && (
						<span className="px-2 py-4 text-[13px] text-muted-foreground">
							Procurando janelas...
						</span>
					)}
					{loaded.status === "error" && (
						<span className="px-2 py-4 text-[13px] text-muted-foreground">
							Não deu para listar as janelas.
						</span>
					)}
					{loaded.status === "ready" && loaded.choices.length === 0 && (
						<span className="px-2 py-4 text-[13px] text-muted-foreground">
							Nenhuma janela aberta.
						</span>
					)}
					{loaded.status === "ready" &&
						loaded.choices.map((choice) => {
							const known = choice.recognized !== null;
							return (
								<button
									key={choice.id}
									type="button"
									disabled={known}
									aria-pressed={selected?.id === choice.id}
									title={known ? `Já reconhecido: ${choice.recognized}` : undefined}
									className={cn(
										"flex items-center gap-3 rounded-md px-2.5 py-2 text-left",
										known ? "opacity-45" : "hover:bg-secondary",
										selected?.id === choice.id && "bg-secondary ring-1 ring-ring",
									)}
									onClick={() => {
										setSelected(choice);
										setName(choice.exe ? exeName(choice.exe) : choice.title);
										setFailure(null);
									}}
								>
									{choice.icon ? (
										<img
											src={choice.icon}
											alt=""
											className="size-7 shrink-0 object-contain"
										/>
									) : (
										<AppWindowIcon
											aria-hidden="true"
											className="size-7 shrink-0 text-muted-foreground"
										/>
									)}
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-[13px] font-medium text-foreground">
											{choice.title}
										</span>
										<span className="truncate font-mono text-[11px] text-muted-foreground">
											{known
												? `Já reconhecido: ${choice.recognized}`
												: choice.exe}
										</span>
									</span>
								</button>
							);
						})}
				</div>
				{selected && (
					<label className="flex flex-col gap-1.5">
						<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
							Nome do jogo
						</span>
						<Input
							value={name}
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
				)}
				{failure && <span className="text-xs text-destructive">{failure}</span>}
				<DialogFooter>
					<DialogClose render={<Button variant="ghost" />}>Cancelar</DialogClose>
					<Button disabled={!selected || !name.trim()} onClick={() => void add()}>
						Adicionar
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

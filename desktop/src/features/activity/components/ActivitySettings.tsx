import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gamepad2Icon, PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
	type ActivitySettingsView,
	activitySettings,
	removeGame,
	setActivityEnabled,
	setGameHidden,
} from "@/lib/tauri/commands";
import { lastSeenLabel } from "../model/playTime";
import { AddGameDialog } from "./AddGameDialog";

/*
 * Configurações › Atividade (ADR 0033, decisão 9; quadros "Configurações — atividade" e
 * "Configurações — adicionar jogo"): a chave geral, os jogos que já abriram neste PC com a chave
 * Mostrar/Escondido de cada um, e os adicionados à mão, com o X para tirar. Tudo fica no PC.
 */

export const activityKeys = { settings: ["activity", "settings"] as const };

function failed(error: unknown): void {
	toast.add({
		title: "Não deu para salvar",
		description:
			typeof error === "object" && error !== null && "message" in error
				? String(error.message)
				: "Tente de novo em instantes.",
		data: { tone: "error" },
	});
}

export function ActivitySettings() {
	const client = useQueryClient();
	const { data } = useQuery({
		queryKey: activityKeys.settings,
		queryFn: activitySettings,
	});
	const [adding, setAdding] = useState(false);

	/** Muda o cache na hora e confirma com o Rust; um erro desfaz. */
	async function change(
		patch: (settings: ActivitySettingsView) => ActivitySettingsView,
		save: () => Promise<unknown>,
	) {
		const before = client.getQueryData<ActivitySettingsView>(
			activityKeys.settings,
		);
		if (before) client.setQueryData(activityKeys.settings, patch(before));
		try {
			await save();
		} catch (error) {
			if (before) client.setQueryData(activityKeys.settings, before);
			failed(error);
		}
		void client.invalidateQueries({ queryKey: activityKeys.settings });
	}

	const enabled = data?.enabled ?? true;
	const manualExes = new Set(
		(data?.manual ?? []).map((game) => game.exe.toLowerCase()),
	);

	return (
		<div className="flex w-full flex-col gap-7 py-20 pr-28 pl-32">
			<div className="flex flex-col gap-1.5">
				<h1 className="text-[22px] leading-tight font-bold text-foreground">
					Atividade
				</h1>
				<span className="text-[13px] text-muted-foreground">
					O jogo aberto aparece só para você, em cima dos seus controles, com o
					botão Transmitir. Ninguém do grupo vê o que você joga.
				</span>
			</div>

			<Group title="Jogo detectado">
				<label className="flex cursor-pointer items-center gap-4 px-4 py-3.5">
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-sm font-medium text-foreground">
							Mostrar o jogo detectado
						</span>
						<span className="text-xs text-muted-foreground">
							Reconhece o jogo pelos launchers do PC (Steam, Epic, EA, Ubisoft,
							Riot, Battle.net e GOG) e pela lista de jogos conhecidos.
						</span>
					</span>
					<Switch
						checked={enabled}
						onCheckedChange={(next) =>
							void change(
								(settings) => ({ ...settings, enabled: next }),
								() => setActivityEnabled(next),
							)
						}
					/>
				</label>
			</Group>

			<Group
				title="Jogos reconhecidos"
				action={
					<Button
						variant="outline"
						size="sm"
						className="text-[13px] font-medium text-foreground"
						onClick={() => setAdding(true)}
					>
						<PlusIcon aria-hidden="true" />
						Adicionar jogo
					</Button>
				}
			>
				{data && data.seen.length === 0 && data.manual.length === 0 && (
					<span className="block px-4 py-5 text-[13px] text-muted-foreground">
						Nenhum jogo abriu ainda neste PC. Abra um jogo, ou use Adicionar
						jogo para um que não foi reconhecido.
					</span>
				)}
				{data?.seen.map((game) => (
					<div key={game.id} className="flex items-center gap-3 px-4 py-2.5">
						<GameIcon icon={game.icon} />
						<span className="flex min-w-0 flex-1 flex-col gap-px">
							<span className="truncate text-sm font-medium text-foreground">
								{game.name}
							</span>
							<span className="truncate text-xs text-muted-foreground">
								Última vez {lastSeenLabel(game.lastSeen, Date.now())}
							</span>
						</span>
						<span className="flex items-center gap-2.5 text-xs text-muted-foreground">
							<span aria-hidden="true">
								{game.hidden ? "Escondido" : "Mostrar"}
							</span>
							<Switch
								aria-label={`Mostrar ${game.name}`}
								checked={!game.hidden}
								onCheckedChange={(show) =>
									void change(
										(settings) => ({
											...settings,
											seen: settings.seen.map((known) =>
												known.id === game.id
													? { ...known, hidden: !show }
													: known,
											),
										}),
										() => setGameHidden(game.id, !show),
									)
								}
							/>
						</span>
						{manualExes.has(game.exe.toLowerCase()) && (
							<RemoveButton
								name={game.name}
								onClick={() =>
									void change(
										(settings) => ({
											...settings,
											manual: settings.manual.filter(
												(known) => known.exe !== game.exe,
											),
										}),
										() => removeGame(game.exe),
									)
								}
							/>
						)}
					</div>
				))}
				{data?.manual
					.filter(
						(game) =>
							!data.seen.some(
								(seen) => seen.exe.toLowerCase() === game.exe.toLowerCase(),
							),
					)
					.map((game) => (
						<div key={game.exe} className="flex items-center gap-3 px-4 py-2.5">
							<GameIcon icon={null} />
							<span className="flex min-w-0 flex-1 flex-col gap-px">
								<span className="truncate text-sm font-medium text-foreground">
									{game.name}
								</span>
								<span className="truncate text-xs text-muted-foreground">
									Adicionado, ainda não abriu
								</span>
							</span>
							<RemoveButton
								name={game.name}
								onClick={() =>
									void change(
										(settings) => ({
											...settings,
											manual: settings.manual.filter(
												(known) => known.exe !== game.exe,
											),
										}),
										() => removeGame(game.exe),
									)
								}
							/>
						</div>
					))}
			</Group>

			<AddGameDialog
				open={adding}
				onClose={() => setAdding(false)}
				onAdded={() =>
					void client.invalidateQueries({ queryKey: activityKeys.settings })
				}
			/>
		</div>
	);
}

function GameIcon({ icon }: { icon: string | null }) {
	return icon ? (
		<img src={icon} alt="" className="size-8 shrink-0 rounded-md object-contain" />
	) : (
		<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
			<Gamepad2Icon aria-hidden="true" className="size-4" />
		</span>
	);
}

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={`Tirar ${name}`}
			title="Tirar dos jogos adicionados"
			onClick={onClick}
		>
			<XIcon aria-hidden="true" />
		</Button>
	);
}

function Group({
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<div className="flex items-end justify-between gap-4">
				<h2
					id={id}
					className="text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase"
				>
					{title}
				</h2>
				{action}
			</div>
			<div className="rounded-[10px] border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
				{children}
			</div>
		</section>
	);
}

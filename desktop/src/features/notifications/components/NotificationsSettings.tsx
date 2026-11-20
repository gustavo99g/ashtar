/**
 * Configurações › Notificações: as chaves de cada aviso, a do som, e o "Testar notificação". Ficam
 * neste computador (`settingsStore`), fora da API.
 *
 * O status Ocupado cala tudo, por cima destas chaves; o aviso no topo lembra disso.
 */
import { BellRingIcon, PlayIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMe, useMyStatus } from "@/features/identity";
import {
	type NotificationPrefs,
	type RoomSoundId,
	useSettingsStore,
} from "@/features/settings";
import { notificationShow } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { type CardInput, cardKey } from "../model/cards";
import { playRoomSound } from "../model/roomSounds";

const cardClass =
	"flex items-center justify-between gap-6 rounded-xl border border-border bg-card py-4 pr-[18px] pl-5";

const ROWS: { key: keyof NotificationPrefs; title: string; text: string }[] = [
	{
		key: "dms",
		title: "Mensagens privadas",
		text: "Um aviso no canto da tela quando alguém escreve para você.",
	},
	{
		key: "mentions",
		title: "Menções",
		text: "Quando alguém escreve o seu @nick num canal, mesmo silenciado.",
	},
	{
		key: "streams",
		title: "Alguém começou a transmitir",
		text: "Clicar no aviso leva você para a sala, já assistindo.",
	},
	{
		key: "sounds",
		title: "Sons",
		text: "Um som curto junto com o aviso, na saída escolhida em Voz e vídeo.",
	},
];

/** Os sons da sala (v0.5): cada um com a sua chave e o botão de ouvir. */
const ROOM_SOUND_ROWS: { id: RoomSoundId; title: string }[] = [
	{ id: "join", title: "Alguém entrou na sala" },
	{ id: "leave", title: "Alguém saiu da sala" },
	{ id: "mute", title: "Você desligou o microfone" },
	{ id: "unmute", title: "Você ligou o microfone" },
	{ id: "deafen", title: "Você desligou o áudio" },
	{ id: "undeafen", title: "Você ligou o áudio" },
	{ id: "shareStart", title: "Alguém começou a transmitir" },
	{ id: "shareStop", title: "Alguém parou de transmitir" },
];

function Row({
	title,
	text,
	checked,
	onChange,
	extra,
}: {
	title: string;
	text?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	/** Algo antes da chave (o botão de ouvir o som). */
	extra?: ReactNode;
}) {
	const labelId = useId();
	return (
		<div className={cardClass}>
			<span className="flex min-w-0 flex-col gap-1">
				<span
					id={labelId}
					className="text-sm leading-tight font-semibold text-foreground"
				>
					{title}
				</span>
				{text && (
					<span className="text-xs leading-normal text-muted-foreground">
						{text}
					</span>
				)}
			</span>
			{extra && <span className="ml-auto flex shrink-0">{extra}</span>}
			<Switch
				variant="blue"
				aria-labelledby={labelId}
				checked={checked}
				onCheckedChange={onChange}
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

/** O cartão de exemplo do "Testar notificação", com o seu nome. Clicar só traz a janela. */
export function sampleCard(
	nick: string,
	displayName: string | null,
	sound: boolean,
): CardInput {
	const target = { kind: "app" } as const;
	return {
		key: cardKey(target),
		kind: "app",
		person: { nick, displayName },
		title: displayName ?? nick,
		context: "Teste",
		body: "É assim que as mensagens chegam com o Ashtar em segundo plano.",
		sound: sound ? "dm" : null,
		target,
	};
}

type TestState = "idle" | "shown" | "quiet";

export function NotificationsSettings() {
	const prefs = useSettingsStore((state) => state.notifications);
	const setNotification = useSettingsStore((state) => state.setNotification);
	const roomSounds = useSettingsStore((state) => state.roomSounds);
	const setRoomSound = useSettingsStore((state) => state.setRoomSound);
	const busy = useMyStatus() === "busy";
	const user = useMe().data?.user;
	const [test, setTest] = useState<TestState>("idle");

	function sendTest() {
		const card = sampleCard(
			user?.nick ?? "ashtar",
			user?.display_name ?? "Ashtar",
			prefs.sounds,
		);
		notificationShow(card)
			.then((shown) => setTest(shown ? "shown" : "quiet"))
			.catch(() => setTest("quiet"));
	}

	return (
		<div className="flex w-full flex-col gap-9 py-20 pr-28 pl-32">
			<h1 className="text-[22px] leading-tight font-bold text-foreground">
				Notificações
			</h1>

			{busy && (
				<p
					role="status"
					className="rounded-xl border border-border bg-card px-5 py-3.5 text-[13px] leading-normal text-muted-foreground"
				>
					Você está como <strong className="text-foreground">Ocupado</strong>:
					nenhum aviso aparece e nada toca até você voltar para Disponível. As não
					lidas e os sons da sala continuam.
				</p>
			)}

			<Section title="Avisos">
				{ROWS.map((row) => (
					<Row
						key={row.key}
						title={row.title}
						text={row.text}
						checked={prefs[row.key]}
						onChange={(checked) => setNotification(row.key, checked)}
					/>
				))}
			</Section>

			<Section title="Sons da sala">
				<p className="-mt-2 text-xs leading-normal text-muted-foreground">
					Só na sala em que você está, e também em Ocupado.
				</p>
				{ROOM_SOUND_ROWS.map((row) => (
					<Row
						key={row.id}
						title={row.title}
						checked={roomSounds[row.id]}
						onChange={(checked) => setRoomSound(row.id, checked)}
						extra={
							<Button
								variant="ghost"
								size="icon"
								aria-label={`Ouvir: ${row.title}`}
								onClick={() => playRoomSound(row.id, { force: true })}
							>
								<PlayIcon aria-hidden="true" className="size-4" />
							</Button>
						}
					/>
				))}
			</Section>

			<Section title="Teste">
				<div className={cardClass}>
					<span className="flex min-w-0 flex-col gap-1">
						<span className="text-sm leading-tight font-semibold text-foreground">
							Testar notificação
						</span>
						<span
							role={test === "idle" ? undefined : "status"}
							className={cn(
								"text-xs leading-normal",
								test === "quiet" ? "text-warning-text" : "text-muted-foreground",
							)}
						>
							{test === "quiet"
								? "O Windows pediu silêncio agora (tela cheia ou apresentação), então o aviso não apareceu."
								: "Mostra um aviso de exemplo no canto da tela, com o som, se ele estiver ligado."}
						</span>
					</span>
					<Button
						variant="outline"
						className="px-3.5 font-medium text-foreground"
						onClick={sendTest}
					>
						<BellRingIcon aria-hidden="true" className="size-[15px]" />
						Testar
					</Button>
				</div>
			</Section>
		</div>
	);
}

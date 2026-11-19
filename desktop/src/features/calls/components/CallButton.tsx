/**
 * O botão Ligar (Etapa 20 da v0.3): no cabeçalho da janela da conversa (`variant="icon"`) e no
 * cartão do usuário (`variant="card"`).
 *
 * Para quem está offline (ou saiu do grupo), fica apagado, com o motivo no tooltip: a ligação não
 * toca para quem não pode atender (ADR 0023). Com outra ligação em andamento, também.
 *
 * Antes de ligar, quem está numa sala vê o "Ligar para fulano?" (até marcar "Não perguntar de
 * novo"), e quem está transmitindo vê sempre o "Ligar e encerrar a transmissão?" (`CallConfirm`).
 *
 * `resolveDm` dá o id da conversa: no cartão do usuário, ela pode ainda não existir, e quem monta
 * (a `features/dms`) a abre antes.
 */
import { PhoneIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useScreenShareState } from "@/features/screen-share";
import { useSettingsStore } from "@/features/settings";
import { SALA, useMaybeVoice, useShareViewers } from "@/features/voice";
import { ApiError, type Shown } from "@/lib/api";
import { cn } from "@/lib/utils";
import { callPerson } from "../actions";
import { personName } from "../model/machine";
import { useCallStore } from "../stores/callStore";
import { CallConfirm, type ConfirmKind } from "./CallConfirm";

export function CallButton({
	person,
	presence,
	resolveDm,
	variant,
	text,
	onCalled,
}: {
	person: { nick: string; display_name: string | null; removed?: boolean };
	/** O status de quem recebe; `null` offline. */
	presence: Shown | null;
	resolveDm: () => Promise<string>;
	/** O ícone do cabeçalho, o botão do cartão ou o link do registro no histórico. */
	variant: "icon" | "card" | "link";
	/** O texto do `link` ("Ligar de novo", "Ligar de volta"). */
	text?: string;
	/** Ligou: quem pôs o botão fecha o cartão. */
	onCalled?: () => void;
}) {
	const name = personName(person);
	const phase = useCallStore((state) => state.phase);
	const voice = useMaybeVoice();
	const voiceKind = voice?.voiceKind ?? null;
	const room = voice?.room ?? null;
	const screenShare = voice?.screenShare ?? null;
	const sharing = useScreenShareState(screenShare).status === "active";
	const viewers = useShareViewers(room, sharing).size;
	const ask = useSettingsStore((state) => state.askBeforeCall);
	const setAsk = useSettingsStore((state) => state.setAskBeforeCall);
	const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const inCall = phase !== "idle" && phase !== "ended";
	const reason = person.removed
		? `${name} saiu do grupo.`
		: presence === null
			? `${name} está offline agora.`
			: inCall
				? "Você já está numa ligação."
				: null;
	const label = reason ?? `Ligar para ${name}`;

	function call() {
		setBusy(true);
		setFailure(null);
		resolveDm()
			.then(callPerson)
			.then(() => onCalled?.())
			.catch((error: unknown) => {
				const message =
					error instanceof ApiError
						? error.message
						: "Não foi possível ligar agora.";
				// No cabeçalho e no histórico não há onde escrever: o motivo vai no aviso do canto.
				if (variant !== "card") {
					toast.add({ title: "Não deu para ligar", description: message });
				} else {
					setFailure(message);
				}
			})
			.finally(() => setBusy(false));
	}

	function start() {
		if (sharing) setConfirm("share");
		else if (voiceKind === "room" && ask) setConfirm("room");
		else call();
	}

	const dialog = (
		<CallConfirm
			kind={confirm}
			name={name}
			roomName={SALA.name}
			viewers={viewers}
			onClose={() => setConfirm(null)}
			onConfirm={(dontAsk) => {
				if (dontAsk) setAsk(false);
				setConfirm(null);
				call();
			}}
		/>
	);

	if (variant === "link") {
		return (
			<>
				<button
					type="button"
					disabled={reason !== null || busy}
					title={reason ?? undefined}
					onClick={start}
					className="text-xs font-medium text-link hover:text-link-hover hover:underline disabled:pointer-events-none disabled:text-foreground-faint"
				>
					{text ?? "Ligar"}
				</button>
				{dialog}
			</>
		);
	}

	if (variant === "icon") {
		return (
			<>
				<button
					type="button"
					aria-label={label}
					title={label}
					aria-disabled={reason !== null || busy}
					onClick={() => {
						if (reason === null && !busy) start();
					}}
					className={cn(
						"flex size-[30px] shrink-0 items-center justify-center rounded-md",
						reason === null
							? "text-muted-foreground hover:bg-secondary hover:text-foreground"
							: "cursor-not-allowed text-foreground-faint",
					)}
				>
					<PhoneIcon aria-hidden="true" className="size-4" />
				</button>
				{dialog}
			</>
		);
	}

	return (
		<div className="flex flex-col gap-1">
			<Button
				variant="secondary"
				className="w-full"
				disabled={reason !== null || busy}
				title={label}
				onClick={start}
			>
				<PhoneIcon aria-hidden="true" />
				Ligar
			</Button>
			{(failure ?? reason) && (
				<p
					role={failure ? "alert" : undefined}
					className={cn(
						"text-xs",
						failure ? "text-destructive-text" : "text-muted-foreground",
					)}
				>
					{failure ?? reason}
				</p>
			)}
			{dialog}
		</div>
	);
}

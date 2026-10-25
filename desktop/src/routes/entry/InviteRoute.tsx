import { ClockIcon, MonitorIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	checkNick,
	ENTERING_TITLE_ID,
	Entering,
	EntryFootnote,
	EntryHeader,
	EntryProblem,
	EntryScreen,
	formatValidUntil,
	NickField,
	PersonCard,
	sameNick,
} from "@/features/entry";
import { useInvitePreview, useRedeemInvite } from "@/features/identity";
import { isApiError, type NameView } from "@/lib/api";
import { paths } from "@/lib/paths";

/**
 * O convite novo (`:code`): lê o convite na API (quem convidou, até quando vale) e pede o nick.
 * Se a API disser que o código é de uma recuperação, vai para a tela dela.
 */
export function InviteRoute() {
	const { code = "" } = useParams();
	const preview = useInvitePreview(code);

	// Com o convite já lido, uma nova leitura que falhe (ao voltar para a janela, por exemplo) não
	// tira a pessoa do meio da escolha do nick.
	const invite = preview.data;
	if (invite === undefined) {
		// No "Tentar de novo", volta para "Entrando…" enquanto lê de novo.
		if (preview.isError && !preview.isFetching) {
			return (
				<EntryProblem
					error={preview.error}
					onRetry={() => void preview.refetch()}
				/>
			);
		}
		return (
			<EntryScreen labelledBy={ENTERING_TITLE_ID}>
				<Entering />
			</EntryScreen>
		);
	}
	if (invite.kind === "recovery") {
		return <Navigate to={paths.entry.recovery(code)} replace />;
	}
	return (
		<ChooseNick
			code={code}
			invitedBy={invite.invited_by}
			expiresAt={invite.expires_at}
		/>
	);
}

interface ChooseNickProps {
	code: string;
	invitedBy: NameView;
	/** Em segundos Unix. */
	expiresAt: number;
}

/** O texto do quadro para o nick em uso (a API diz só "Esse nick já está em uso."). */
const NICK_TAKEN = "Esse nick já está em uso. Tente outro.";

/**
 * A escolha do nick. "Entrar no Ashtar" cria a conta (`redeem`) e vai para a tela do servidor.
 * O botão só libera com um nick que passa nas regras.
 */
function ChooseNick({ code, invitedBy, expiresAt }: ChooseNickProps) {
	const navigate = useNavigate();
	const redeem = useRedeemInvite();
	const [nick, setNick] = useState("");
	// O nick que a API disse estar em uso: continua recusado enquanto o campo tiver o mesmo nick.
	const [takenNick, setTakenNick] = useState<string | null>(null);

	const check = checkNick(nick);
	const taken = takenNick !== null && sameNick(nick, takenNick);
	const error = redeem.error;
	// A recusa da API volta para o campo; o convite não foi gasto.
	let rejection: string | null = null;
	if (taken) rejection = NICK_TAKEN;
	else if (isApiError(error, "invalid_nick")) rejection = error.message;

	function redeemWith(chosen: string) {
		redeem.mutate(
			{ code, nick: chosen },
			{
				onSuccess: () => void navigate(paths.server, { replace: true }),
				onError: (failure) => {
					if (isApiError(failure, "nick_taken")) setTakenNick(chosen);
					// Este computador já tinha conta: o `redeemInvite` já fez o login.
					if (isApiError(failure, "device_already_linked")) {
						void navigate(paths.entry.alreadyIn, { replace: true });
					}
				},
			},
		);
	}

	function enter(event: FormEvent) {
		event.preventDefault();
		redeemWith(check.nick);
	}

	if (
		error &&
		!isApiError(error, "nick_taken") &&
		!isApiError(error, "invalid_nick") &&
		!isApiError(error, "device_already_linked")
	) {
		// O campo não muda enquanto o erro está na tela: "Tentar de novo" manda o mesmo nick.
		return (
			<EntryProblem error={error} onRetry={() => redeemWith(check.nick)} />
		);
	}

	return (
		<EntryScreen labelledBy="nick-titulo">
			<EntryHeader
				titleId="nick-titulo"
				title="Você recebeu um convite"
				description="Escolha seu nick. Ele é só seu e não muda depois."
			/>
			<PersonCard
				nick={invitedBy.nick}
				detail={
					<>
						<ClockIcon aria-hidden="true" className="size-3" />
						Vale até {formatValidUntil(expiresAt)}
					</>
				}
			>
				<span className="font-semibold text-gold">{invitedBy.nick}</span> te
				convidou para o Ashtar
			</PersonCard>
			<form noValidate onSubmit={enter} className="flex flex-col gap-6">
				<NickField
					value={nick}
					onChange={(value) => {
						setNick(value);
						redeem.reset();
					}}
					rejection={rejection}
				/>
				<Button
					type="submit"
					size="lg"
					className="w-full"
					disabled={!check.valid || taken || redeem.isPending}
				>
					Entrar no Ashtar
				</Button>
			</form>
			<EntryFootnote className="flex gap-2.5">
				<MonitorIcon aria-hidden="true" className="mt-px size-4 shrink-0" />
				<span>
					Sua conta fica ligada a este computador. Se trocar de computador, peça
					ao dono um link de recuperação.
				</span>
			</EntryFootnote>
		</EntryScreen>
	);
}

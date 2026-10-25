import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	ENTERING_TITLE_ID,
	Entering,
	EntryFootnote,
	EntryHeader,
	EntryMessage,
	EntryProblem,
	EntryScreen,
	PersonCard,
} from "@/features/entry";
import {
	Avatar,
	PersonName,
	useInvitePreview,
	useRedeemInvite,
} from "@/features/identity";
import { isApiError } from "@/lib/api";
import { paths } from "@/lib/paths";

/**
 * A recuperação (`:code`): mostra de quem é a conta e passa a conta para este computador, sem
 * pedir nick. O computador antigo sai dela. Se a API disser que o código é de um convite novo, vai
 * para a escolha do nick.
 */
export function RecoveryRoute() {
	const { code = "" } = useParams();
	const navigate = useNavigate();
	const preview = useInvitePreview(code);
	const redeem = useRedeemInvite();

	// Antes da leitura do convite: depois de usado, o convite não vale mais, e uma nova leitura
	// (ao voltar para a janela, por exemplo) falharia por cima das boas-vindas.
	if (redeem.isSuccess) {
		const { nick } = redeem.data;
		return (
			<EntryScreen labelledBy="recuperacao-pronta">
				<EntryMessage
					titleId="recuperacao-pronta"
					media={<Avatar nick={nick} size={72} />}
					title={
						<>
							Boas-vindas de volta,{" "}
							<PersonName className="font-bold">{nick}</PersonName>
						</>
					}
					description="Sua conta agora está neste computador."
					action={
						<Button
							size="lg"
							className="w-full"
							onClick={() => void navigate(paths.server, { replace: true })}
						>
							Abrir o Ashtar
						</Button>
					}
				/>
			</EntryScreen>
		);
	}

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
	if (invite.kind === "new") {
		return <Navigate to={paths.entry.invite(code)} replace />;
	}

	function moveAccount() {
		redeem.mutate(
			{ code, nick: null },
			{
				onError: (rejection) => {
					// Este computador já tinha conta: o `redeemInvite` já fez o login.
					if (isApiError(rejection, "device_already_linked")) {
						void navigate(paths.entry.alreadyIn, { replace: true });
					}
				},
			},
		);
	}

	if (redeem.isError && !isApiError(redeem.error, "device_already_linked")) {
		return <EntryProblem error={redeem.error} onRetry={moveAccount} />;
	}

	const { nick } = invite.account;
	return (
		<EntryScreen labelledBy="recuperacao-titulo">
			<EntryHeader
				titleId="recuperacao-titulo"
				title="Trocar de computador"
				description="Este link de recuperação passa a sua conta para este computador. O computador antigo sai dela."
			/>
			<PersonCard nick={nick} detail="Nick e permissões continuam os mesmos">
				Conta de <PersonName>{nick}</PersonName>
			</PersonCard>
			<Button
				size="lg"
				className="w-full"
				disabled={redeem.isPending}
				onClick={moveAccount}
			>
				Usar este computador
			</Button>
			<EntryFootnote className="text-center">
				Não pediu isso? Feche o Ashtar e avise o dono.
			</EntryFootnote>
		</EntryScreen>
	);
}

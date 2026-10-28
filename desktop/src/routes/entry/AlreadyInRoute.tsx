import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EntryMessage, EntryScreen } from "@/features/entry";
import { Avatar, PersonName, useSession } from "@/features/identity";
import { paths } from "@/lib/paths";

/**
 * "Você já está no Ashtar": veio um link, mas este computador já tem conta. O convite não é
 * usado e continua valendo para outra pessoa. Também aparece quando o `redeem` responde
 * `device_already_linked` (a sessão já entrou pelo login).
 */
export function AlreadyInRoute() {
	const session = useSession();
	const navigate = useNavigate();

	// Sem sessão não há conta para mostrar: a abertura decide de novo.
	if (session.status !== "connected") {
		return <Navigate to={paths.start} replace />;
	}
	const { nick } = session.user;

	return (
		<EntryScreen labelledBy="ja-entrou-titulo">
			<EntryMessage
				titleId="ja-entrou-titulo"
				media={<Avatar nick={nick} size={44} />}
				title="Você já está no Ashtar"
				description={
					<>
						Este computador já é da conta de <PersonName>{nick}</PersonName>. O
						convite continua valendo para outra pessoa.
					</>
				}
				action={
					<Button
						size="lg"
						className="w-full"
						onClick={() => void navigate(paths.server, { replace: true })}
					>
						Continuar como {nick}
					</Button>
				}
			/>
		</EntryScreen>
	);
}

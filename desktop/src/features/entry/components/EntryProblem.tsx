import {
	ClockIcon,
	CloudOffIcon,
	DownloadIcon,
	Link2OffIcon,
	type LucideIcon,
	TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyMedia } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/features/identity";
import { ApiError, type InviteRefusal, isApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { useUpdateNow } from "../hooks/useUpdateNow";
import { EntryMessage } from "./EntryMessage";
import { EntryScreen } from "./EntryScreen";

const TITLE_ID = "entrada-problema";

interface EntryProblemProps {
	/** Um `ApiError`; outro erro qualquer aparece como uma falha do app. */
	error: unknown;
	/** O "Tentar de novo": repete o que falhou (o login, a leitura do convite, o `redeem`). */
	onRetry: () => void;
}

/**
 * O que a entrada mostra quando a API recusa ou não responde, pelo `kind` do erro (a tabela
 * "Estados e erros" do doc). O nick em uso e o nick inválido não chegam aqui: ficam no campo.
 */
export function EntryProblem({ error: failure, onRetry }: EntryProblemProps) {
	const error = isApiError(failure)
		? failure
		: new ApiError({ status: 0, kind: "app", message: String(failure) });
	if (error.kind === "client_outdated")
		return <OutdatedProblem minVersion={error.minVersion} />;
	if (error.kind === "invalid_invite")
		return <InvalidInviteProblem reason={error.reason} />;

	const retry = (variant: "primary" | "secondary") => (
		<Button
			variant={variant}
			size="lg"
			className={cn(
				"w-full",
				variant === "secondary" && "border-border-strong",
			)}
			onClick={onRetry}
		>
			Tentar de novo
		</Button>
	);

	if (error.kind === "network" || error.kind === "timeout") {
		return (
			<Problem
				tone="danger"
				icon={CloudOffIcon}
				title="Sem conexão com o servidor"
				description="Confira sua internet. Se ela estiver ok, o servidor pode estar fora do ar; avise o dono."
				action={retry("primary")}
			/>
		);
	}
	if (error.kind === "too_many_attempts") {
		return (
			<Problem
				tone="warning"
				icon={ClockIcon}
				title="Muitas tentativas"
				description="Espere alguns minutos e tente de novo."
				action={retry("secondary")}
			/>
		);
	}
	if (
		error.kind === "internal" ||
		error.kind === "http" ||
		error.status >= 500
	) {
		return (
			<Problem
				tone="danger"
				icon={TriangleAlertIcon}
				title="Algo deu errado no servidor"
				description="Tente de novo. Se continuar, avise o dono."
				action={retry("secondary")}
			/>
		);
	}
	// O resto nasce no app (a chave do computador, o próprio comando): a mensagem diz o quê.
	return (
		<Problem
			tone="danger"
			icon={TriangleAlertIcon}
			title="Não foi possível entrar"
			description={error.message}
			action={retry("secondary")}
		/>
	);
}

/**
 * O título e o texto de cada motivo (v0.9). Sem motivo (o servidor antigo) ou com o código que não
 * existe, fica o texto de antes, que cobre o link copiado pela metade.
 */
const INVALID_INVITE: Record<
	InviteRefusal,
	{ title: string; description: string }
> = {
	not_found: {
		title: "Esse convite não vale mais",
		description:
			"Confira se copiou o link inteiro. Se copiou, peça um link novo ao dono.",
	},
	expired: {
		title: "Esse convite venceu",
		description: "Todo convite tem prazo. Peça um link novo ao dono.",
	},
	used: {
		title: "Esse convite já foi usado",
		description: "Ele já serviu para quem devia. Peça um link novo ao dono.",
	},
	revoked: {
		title: "Esse convite foi cancelado",
		description: "O dono cancelou esse link. Peça um novo a ele.",
	},
};

const UNKNOWN_REASON = {
	title: "Esse convite não vale mais",
	description:
		"Ele pode ter expirado, sido cancelado ou já ter sido usado. Peça um link novo ao dono.",
};

/** O convite recusado, com o motivo: volta para o campo de colar, na tela de onde a pessoa veio. */
function InvalidInviteProblem({ reason }: { reason: InviteRefusal | null }) {
	const session = useSession();
	const navigate = useNavigate();
	const pasteScreen =
		session.status === "leftGroup"
			? paths.entry.leftGroup
			: paths.entry.noInvite;
	const { title, description } = reason
		? INVALID_INVITE[reason]
		: UNKNOWN_REASON;

	return (
		<Problem
			tone="warning"
			icon={Link2OffIcon}
			title={title}
			description={description}
			action={
				<Button
					variant="secondary"
					size="lg"
					className="w-full border-border-strong"
					onClick={() => void navigate(pasteScreen, { replace: true })}
				>
					Colar outro link
				</Button>
			}
		/>
	);
}

/** "Atualize o Ashtar para entrar", com o "Atualizar agora" que baixa e reinicia. */
function OutdatedProblem({ minVersion }: { minVersion: string | null }) {
	const { state, start } = useUpdateNow();
	const busy = state.status === "checking" || state.status === "installing";

	return (
		<Problem
			tone="info"
			icon={DownloadIcon}
			title="Atualize o Ashtar para entrar"
			description={
				<>
					Esta versão não funciona mais com o servidor.
					<br />
					<span className="font-mono text-[11px]">
						você tem {__APP_VERSION__}
						{minVersion && ` · mínima ${minVersion}`}
					</span>
					{state.status === "failed" && (
						<span className="mt-3 block text-xs text-destructive-text">
							{state.message}
						</span>
					)}
				</>
			}
			action={
				<Button size="lg" className="w-full" disabled={busy} onClick={start}>
					{busy && <Spinner aria-hidden="true" role={undefined} />}
					{busy ? "Atualizando…" : "Atualizar agora"}
				</Button>
			}
		/>
	);
}

interface ProblemProps {
	tone: "danger" | "warning" | "info";
	icon: LucideIcon;
	title: string;
	description: ReactNode;
	action: ReactNode;
}

function Problem({
	tone,
	icon: Icon,
	title,
	description,
	action,
}: ProblemProps) {
	return (
		<EntryScreen labelledBy={TITLE_ID}>
			<EntryMessage
				role="alert"
				titleId={TITLE_ID}
				media={
					<EmptyMedia tone={tone}>
						<Icon />
					</EmptyMedia>
				}
				title={title}
				description={description}
				action={action}
			/>
		</EntryScreen>
	);
}

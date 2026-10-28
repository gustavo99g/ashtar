import { CloudOffIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "./empty";
import { Spinner } from "./spinner";

/*
 * Os estados que toda tela usa: carregando, vazio, erro, sem conexão e conectando. Os textos
 * padrão são os do canvas; cada tela pode trocar.
 */

interface StateProps {
	title?: ReactNode;
	description?: ReactNode;
	className?: string;
}

interface RetryProps {
	/** Mostra o botão "Tentar de novo". */
	onRetry?: () => void;
}

function LoadingState({ title, description, className }: StateProps) {
	return (
		<Empty data-state="loading" className={className}>
			<EmptyHeader>
				<Spinner className="size-6 text-primary" />
				{title && <EmptyTitle>{title}</EmptyTitle>}
				{description && <EmptyDescription>{description}</EmptyDescription>}
			</EmptyHeader>
		</Empty>
	);
}

function EmptyState({
	icon,
	title,
	description,
	action,
	className,
}: StateProps & { icon: ReactNode; title: ReactNode; action?: ReactNode }) {
	return (
		<Empty data-state="empty" className={className}>
			<EmptyHeader>
				<EmptyMedia tone="neutral">{icon}</EmptyMedia>
				<EmptyTitle className="text-sm">{title}</EmptyTitle>
				{description && <EmptyDescription>{description}</EmptyDescription>}
			</EmptyHeader>
			{action && <EmptyContent>{action}</EmptyContent>}
		</Empty>
	);
}

function RetryButton({
	onRetry,
	variant,
}: RetryProps & { variant: "primary" | "secondary" }) {
	if (!onRetry) return null;
	return (
		<EmptyContent>
			<Button variant={variant} className="w-full" onClick={onRetry}>
				Tentar de novo
			</Button>
		</EmptyContent>
	);
}

function ErrorState({
	title = "Algo deu errado no servidor",
	description = "Tente de novo. Se continuar, avise o dono.",
	onRetry,
	className,
}: StateProps & RetryProps) {
	return (
		<Empty data-state="error" role="alert" className={className}>
			<EmptyHeader>
				<EmptyMedia tone="danger">
					<TriangleAlertIcon />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			<RetryButton onRetry={onRetry} variant="secondary" />
		</Empty>
	);
}

function OfflineState({
	title = "Sem conexão com o servidor",
	description = "Confira sua internet. Se ela estiver ok, o servidor pode estar fora do ar; avise o dono.",
	onRetry,
	className,
}: StateProps & RetryProps) {
	return (
		<Empty data-state="offline" role="alert" className={className}>
			<EmptyHeader>
				<EmptyMedia tone="danger">
					<CloudOffIcon />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			<RetryButton onRetry={onRetry} variant="primary" />
		</Empty>
	);
}

function ConnectingState({
	title = "Conectando…",
	description,
	className,
}: StateProps) {
	return (
		<div
			data-state="connecting"
			role="status"
			className={cn("flex items-center gap-2.5", className)}
		>
			<Spinner
				aria-hidden="true"
				role={undefined}
				className="size-[18px] text-status-connecting"
			/>
			<div className="flex min-w-0 flex-col">
				<span className="text-[13px] font-semibold text-status-connecting">
					{title}
				</span>
				{description && (
					<span className="truncate text-xs text-muted-foreground">
						{description}
					</span>
				)}
			</div>
		</div>
	);
}

export { ConnectingState, EmptyState, ErrorState, LoadingState, OfflineState };

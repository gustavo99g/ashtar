import { CrownIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMe } from "@/features/identity";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";

/*
 * As configurações, por cima do `AppShell`: o menu do canvas à esquerda e a página no meio.
 *
 * Abrir as configurações empilha uma rota; trocar de página no menu substitui (`replace`). Assim
 * fechar (o X ou o ESC) é sempre um passo para trás, de volta para onde a pessoa estava.
 */

function MenuGroup({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="flex items-center gap-1.5 px-2.5 pb-1.5 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				{label}
			</span>
			{children}
		</div>
	);
}

const itemClass = "flex h-[34px] items-center rounded-md px-2.5 text-sm";

function MenuItem({ to, children }: { to: string; children: ReactNode }) {
	return (
		<NavLink
			to={to}
			replace
			className={({ isActive }) =>
				cn(
					itemClass,
					isActive
						? "bg-selected font-semibold text-selected-foreground"
						: "text-secondary-foreground hover:bg-secondary hover:text-foreground",
				)
			}
		>
			{children}
		</NavLink>
	);
}

function MenuSeparator() {
	return <span aria-hidden="true" className="mx-2.5 my-3 h-px bg-border" />;
}

export function SettingsLayout() {
	const navigate = useNavigate();
	// Escondido até o `/api/me` responder: quem decide de verdade é a API, aqui é só o menu.
	const showPanel = useMe().data?.can_view_panel === true;
	const channel = useMe().data?.update_channel;
	const showServer = useMe().data?.can_manage_channels === true;
	// O estado do servidor é só do dono (decisão 17); os logs, de quem tem "Ver logs" (v0.7).
	const isOwner = useMe().data?.user.is_owner === true;
	const showEmojis = useMe().data?.can_manage_emojis === true;
	const showLogs = useMe().data?.can_view_logs === true;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// Um diálogo ou menu aberto dentro das configurações fecha primeiro: o Base UI marca o
			// ESC que ele usou com `preventDefault`.
			if (event.key !== "Escape" || event.defaultPrevented) return;
			navigate(-1);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [navigate]);

	return (
		<div className="absolute inset-0 z-30 flex bg-background">
			<nav
				aria-label="Configurações"
				className="flex w-80 shrink-0 flex-col gap-0.5 overflow-y-auto bg-card py-14 pr-4 pl-12"
			>
				<MenuGroup label="Você">
					<MenuItem to={paths.settings.profile}>Perfil</MenuItem>
				</MenuGroup>
				<MenuSeparator />
				<MenuGroup label="Ajustes">
					<MenuItem to={paths.settings.voice}>Voz e vídeo</MenuItem>
					<MenuItem to={paths.settings.shortcuts}>Atalhos</MenuItem>
					<MenuItem to={paths.settings.notifications}>Notificações</MenuItem>
					<MenuItem to={paths.settings.app}>Aplicativo</MenuItem>
				</MenuGroup>
				{showServer && (
					<>
						<MenuSeparator />
						<MenuGroup label="Servidor">
							<MenuItem to={paths.settings.archived}>Arquivados</MenuItem>
						</MenuGroup>
					</>
				)}
				{(showPanel || showEmojis || showLogs) && (
					<>
						<MenuSeparator />
						<MenuGroup
							label={
								<>
									Painel de controle
									<CrownIcon aria-hidden="true" className="size-3 text-gold" />
								</>
							}
						>
							{showPanel && (
								<>
									<MenuItem to={paths.settings.invites}>Convites</MenuItem>
									<MenuItem to={paths.settings.members}>Membros</MenuItem>
								</>
							)}
							{showEmojis && (
								<MenuItem to={paths.settings.emojis}>Emojis</MenuItem>
							)}
							{showLogs && (
								<MenuItem to={paths.settings.logs}>Logs</MenuItem>
							)}
							{isOwner && (
								<>
									<MenuItem to={paths.settings.audit}>Registro</MenuItem>
									<MenuItem to={paths.settings.server}>Servidor</MenuItem>
								</>
							)}
						</MenuGroup>
					</>
				)}
				<MenuSeparator />
				{/* O canal só aparece depois do `/api/me`, como na tela Aplicativo. */}
				<span className="px-2.5 font-mono text-[11px] text-muted-foreground">
					Ashtar {__APP_VERSION__}
					{channel === "beta" && " · beta"}
					{channel === "stable" && " · estável"}
				</span>
			</nav>
			<div className="relative flex min-w-0 flex-1 overflow-y-auto">
				<div className="min-w-0 flex-1">
					<Outlet />
				</div>
				<div className="sticky top-0 flex shrink-0 flex-col items-center gap-1.5 self-start pt-14 pr-16">
					<button
						type="button"
						aria-label="Fechar configurações"
						onClick={() => navigate(-1)}
						className="flex size-10 items-center justify-center rounded-full border-2 border-foreground-subtle text-secondary-foreground hover:bg-secondary hover:text-foreground"
					>
						<XIcon className="size-[18px]" strokeWidth={2.25} />
					</button>
					<span
						aria-hidden="true"
						className="font-mono text-[11px] text-muted-foreground"
					>
						ESC
					</span>
				</div>
			</div>
		</div>
	);
}

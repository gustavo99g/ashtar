import {
	MessageCircleIcon,
	PanelRightOpenIcon,
	UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { CountBadge } from "@/features/unread";
import {
	openSideTab,
	type SideContext,
	type SideTab,
	setSideOpen,
} from "../stores/sidePanelStore";

/**
 * A lateral minimizada, como no quadro "Lateral — minimizada na sala": uma faixa de 52 com o
 * botão de abrir, um traço e os ícones das duas abas. Clicar num ícone abre a lateral já naquela
 * aba; o botão de cima abre na aba em que ela estava.
 */
export function SideStrip({
	context,
	dmsUnread = 0,
}: {
	context: SideContext;
	dmsUnread?: number;
}) {
	return (
		<aside
			aria-label="Lateral minimizada"
			className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-l border-border bg-card pt-1.5"
		>
			<StripButton label="Abrir lateral" onClick={() => setSideOpen(context, true)}>
				<PanelRightOpenIcon aria-hidden="true" className="size-[18px]" />
			</StripButton>
			<span aria-hidden="true" className="h-px w-6 bg-border" />
			<TabButton context={context} tab="members" label="Membros">
				<UsersIcon aria-hidden="true" className="size-5" />
			</TabButton>
			<TabButton context={context} tab="dms" label="Conversas">
				<MessageCircleIcon aria-hidden="true" className="size-5" />
				<CountBadge
					count={dmsUnread}
					className="absolute -top-[3px] -right-[3px] h-[18px] border-2 border-card px-1 py-0 text-[10.5px] leading-[14px]"
				/>
			</TabButton>
		</aside>
	);
}

function TabButton({
	context,
	tab,
	label,
	children,
}: {
	context: SideContext;
	tab: SideTab;
	label: string;
	children: ReactNode;
}) {
	return (
		<StripButton label={label} onClick={() => openSideTab(context, tab)}>
			{children}
		</StripButton>
	);
}

function StripButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
		>
			{children}
		</button>
	);
}

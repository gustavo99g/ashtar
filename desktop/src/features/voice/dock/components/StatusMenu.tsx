import { CheckIcon, PencilIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Avatar,
	STATUS_OPTIONS,
	StatusDot,
	useMyStatus,
	useSetStatus,
} from "@/features/identity";
import type { Status, UserView } from "@/lib/api";
import { paths } from "@/lib/paths";

/**
 * O menu de status, como no quadro "Status — menu no seu painel": abre no avatar e no nome do
 * painel (`trigger`), com quem você é no alto, os quatro status (cada um com a explicação) e o atalho
 * Editar perfil. Trocar vale na hora; se a API recusar, volta.
 */
export function StatusMenu({
	user,
	trigger,
}: {
	user: UserView;
	/** O avatar e o nome do painel: o que abre o menu. */
	trigger: ReactNode;
}) {
	const navigate = useNavigate();
	const status = useMyStatus();
	const setStatus = useSetStatus();
	const name = user.display_name?.trim() || user.nick;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Seu status"
				className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pr-1 pl-1 text-left hover:bg-accent data-popup-open:bg-accent"
			>
				{trigger}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side="top"
				align="start"
				sideOffset={10}
				aria-label="Seu status"
				className="w-[264px]"
			>
				<div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
					<Avatar
						nick={user.nick}
						displayName={user.display_name}
						size={40}
						badge={
							<StatusDot
								status={status}
								className="size-3.5 border-popover"
							/>
						}
					/>
					<span className="flex min-w-0 flex-col gap-px">
						<span className="truncate text-sm font-bold text-gold">{name}</span>
						<span className="truncate text-xs text-muted-foreground">
							{user.is_owner ? "Dono do Ashtar" : `@${user.nick}`}
						</span>
					</span>
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={status}
					onValueChange={(value) => setStatus.mutate(value as Status)}
				>
					{STATUS_OPTIONS.map((option) => (
						<DropdownMenuRadioItem
							key={option.value}
							value={option.value}
							closeOnClick
						>
							<span className="relative mt-[3px] flex size-3 shrink-0">
								<StatusDot
									status={option.value}
									className="static size-3 border-popover"
								/>
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="text-[13.5px] font-semibold">
									{option.label}
								</span>
								<span className="text-xs leading-[1.4] text-muted-foreground">
									{option.description}
								</span>
							</span>
							<span className="mt-0.5 flex size-4 shrink-0 text-link">
								{option.value === status && (
									<CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.6} />
								)}
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => void navigate(paths.settings.profile)}>
					<PencilIcon className="size-4 text-muted-foreground" />
					Editar perfil
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

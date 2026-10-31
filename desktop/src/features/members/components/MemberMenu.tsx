import {
	CrownIcon,
	EllipsisIcon,
	KeyRoundIcon,
	UnplugIcon,
	UserRoundIcon,
	UserXIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MemberView } from "@/lib/api";
import { memberName } from "../members";

/*
 * O menu dos "..." de cada membro (quadro "Membros"). Desvincular só aparece com computador, e
 * nunca no próprio dono do app: desvincular a si mesmo derrubaria a sessão de quem está usando.
 * O dono não sai do grupo.
 */

export interface MemberActions {
	onOpen: () => void;
	onRecovery: () => void;
	onUnlink: () => void;
	onRemove: () => void;
}

interface MemberMenuProps extends MemberActions {
	member: MemberView;
	canUnlink: boolean;
}

export function MemberMenu({
	member,
	canUnlink,
	onOpen,
	onRecovery,
	onUnlink,
	onRemove,
}: MemberMenuProps) {
	const name = memberName(member);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Mais ações para ${name}`}
						className="text-muted-foreground data-popup-open:bg-accent"
					/>
				}
			>
				<EllipsisIcon className="size-[17px]" />
			</DropdownMenuTrigger>
			<DropdownMenuContent aria-label={`Ações para ${name}`}>
				<DropdownMenuItem onClick={onOpen}>
					<UserRoundIcon className="size-[15px]" />
					Ver detalhes e permissões
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onRecovery}>
					<KeyRoundIcon className="size-[15px]" />
					Criar convite de recuperação
				</DropdownMenuItem>
				{canUnlink && (
					<DropdownMenuItem
						onClick={onUnlink}
						className="text-warning-text data-highlighted:bg-warning-subtle"
					>
						<UnplugIcon className="size-[15px]" />
						Desvincular computador
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				{member.is_owner ? (
					<span className="flex items-center gap-2 px-2.5 py-2 text-xs text-foreground-subtle">
						<CrownIcon className="size-[13px]" />O dono não sai do grupo.
					</span>
				) : (
					<DropdownMenuItem variant="danger" onClick={onRemove}>
						<UserXIcon className="size-[15px]" />
						Remover do grupo
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

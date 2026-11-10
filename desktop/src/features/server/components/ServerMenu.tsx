import {
	ArchiveIcon,
	ArrowUpDownIcon,
	ChevronDownIcon,
	FolderPlusIcon,
	PlusIcon,
	UserPlusIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/ashtar.svg";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openChannelDialog, useCanManageChannels } from "@/features/channels";
import { useMe } from "@/features/identity";
import { paths } from "@/lib/paths";

/** O nome do grupo, no alto da coluna. */
const SERVER_NAME = "Ashtar";

/*
 * O alto da coluna: o ícone e o nome do grupo. Para quem tem o que fazer, o nome é o botão do menu
 * do servidor (ADR 0020), e cada um vê só o que pode:
 *
 * - **Convidar pessoas**, para quem vê o Painel (o dono): leva a Configurações › Convites. O
 *   convite rápido continua na sala de voz.
 * - **Criar canal, Criar categoria, Organizar canais e Canais arquivados**, para quem gerencia os
 *   canais.
 *
 * Quem não tem nenhum item não ganha menu: o nome é só texto.
 */
export function ServerMenu() {
	const navigate = useNavigate();
	const { data: me } = useMe();
	const canManage = useCanManageChannels();
	const canInvite = me?.can_view_panel ?? false;

	const name = (
		<>
			<img src={logo} alt="" className="size-7 rounded-lg" />
			<span className="min-w-0 flex-1 truncate text-left">{SERVER_NAME}</span>
		</>
	);
	const bar =
		"flex h-12 w-full shrink-0 items-center gap-2.5 border-b border-border px-4 text-[15px] font-bold";

	if (!canManage && !canInvite) return <div className={bar}>{name}</div>;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Menu do ${SERVER_NAME}`}
				className={`${bar} hover:bg-secondary data-popup-open:bg-secondary`}
			>
				{name}
				<ChevronDownIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				alignOffset={8}
				sideOffset={4}
				aria-label={SERVER_NAME}
				className="w-[224px]"
			>
				{canInvite && (
					<DropdownMenuItem
						onClick={() => void navigate(paths.settings.invites)}
					>
						<UserPlusIcon className="size-[15px]" />
						Convidar pessoas
					</DropdownMenuItem>
				)}
				{canInvite && canManage && <DropdownMenuSeparator />}
				{canManage && (
					<>
						<DropdownMenuItem
							onClick={() =>
								openChannelDialog({ kind: "createChannel", categoryId: null })
							}
						>
							<PlusIcon className="size-[15px]" />
							Criar canal
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => openChannelDialog({ kind: "createCategory" })}
						>
							<FolderPlusIcon className="size-[15px]" />
							Criar categoria
						</DropdownMenuItem>
						{/* Desligado até a Etapa 2, que traz o modo Organizar. */}
						<DropdownMenuItem disabled>
							<ArrowUpDownIcon className="size-[15px]" />
							Organizar canais
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => void navigate(paths.settings.archived)}
						>
							<ArchiveIcon className="size-[15px]" />
							Canais arquivados
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

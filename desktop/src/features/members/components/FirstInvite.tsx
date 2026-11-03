import { PlusIcon, TicketIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/features/identity";
import type { MemberView } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";

/*
 * O primeiro uso (quadro "Membros (primeiro uso)"): só o dono no grupo. Os filtros e o "Convidar
 * alguém" saem, e o convite vira o centro da tela.
 */

const SLOTS = ["opacity-100", "opacity-60", "opacity-30"];

export function FirstInvite({ owner }: { owner: MemberView }) {
	const navigate = useNavigate();
	return (
		<div className="mt-5 flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-border-strong bg-radial-[ellipse_55%_90%_at_50%_0%] from-primary/12 to-transparent to-70% px-8 pt-10 pb-9 text-center duration-280 animate-in fade-in-0 slide-in-from-bottom-2">
			<div aria-hidden="true" className="mb-1.5 flex items-center">
				<Avatar nick={owner.nick} displayName={owner.display_name} size={48} />
				{SLOTS.map((opacity) => (
					<span
						key={opacity}
						className={cn(
							"ml-2 flex size-11 items-center justify-center rounded-full border-2 border-dashed border-foreground-faint bg-background text-foreground-faint",
							opacity,
						)}
					>
						<PlusIcon className="size-4" />
					</span>
				))}
			</div>
			<h2 className="text-lg font-bold text-foreground">Só você por aqui</h2>
			<p className="max-w-[440px] text-[13px] leading-[1.55] text-muted-foreground">
				Crie um convite e mande no grupo da galera. Quem clicar no link entra,
				escolhe o nick e aparece aqui.
			</p>
			<Button
				className="mt-2"
				onClick={() => void navigate(paths.settings.invites, { replace: true })}
			>
				<TicketIcon className="size-[15px]" />
				Criar o primeiro convite
			</Button>
		</div>
	);
}

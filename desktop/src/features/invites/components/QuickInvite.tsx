import {
	ArrowRightIcon,
	CheckIcon,
	CopyIcon,
	UserPlusIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/lib/paths";
import { expiryTime, inviteAddress } from "../model/format";
import { useCreateInvite } from "../queries";
import {
	forgetQuickInvite,
	isStillValid,
	type QuickInvite as QuickInviteValue,
	rememberQuickInvite,
	timeLeft,
	useQuickInviteStore,
} from "../stores/quickInviteStore";
import { useNow } from "../hooks/useNow";
import { InviteStatusPill } from "./InviteStatusPill";
import { InviteTicket } from "./InviteTicket";

/*
 * O Convidar da sala (quadro "Convite rápido"). Na primeira vez cria um convite "Para o grupo";
 * enquanto ele vale, abrir de novo mostra o mesmo. Quem usa só desenha isto com
 * `can_create_invite`; o "Mais opções" leva aos Convites do Painel, que pedem `can_view_panel`.
 */

/** Quanto tempo o botão fica em "Copiado". */
const COPIED_MS = 2000;

export function QuickInvite({ canViewPanel }: { canViewPanel: boolean }) {
	const [open, setOpen] = useState(false);
	const current = useQuickInviteStore((state) => state.current);
	const createInvite = useCreateInvite();

	function create() {
		forgetQuickInvite();
		createInvite.reset();
		// `mutateAsync`, e não o `onSuccess` do `mutate`: se a pessoa sair da sala antes da resposta,
		// o convite criado fica guardado mesmo assim, em vez de virar um segundo na próxima vez.
		createInvite.mutateAsync({ preset: "group" }).then(
			(invite) => rememberQuickInvite(invite),
			() => {},
		);
	}

	function onOpenChange(next: boolean) {
		setOpen(next);
		if (!next || createInvite.isPending) return;
		const { current: remembered } = useQuickInviteStore.getState();
		if (!remembered || !isStillValid(remembered.invite, Date.now())) create();
	}

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="sm"
						className="px-2.5 text-[13px] font-normal data-popup-open:bg-secondary data-popup-open:text-foreground"
					/>
				}
			>
				<UserPlusIcon />
				Convidar
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={6}
				className="w-[392px] gap-3.5 rounded-[14px] bg-card p-[18px]"
			>
				<div className="flex items-start gap-3">
					<div className="flex min-w-0 grow flex-col gap-1">
						<PopoverTitle className="text-[15px] font-bold">
							{current ? "Convite criado" : "Convite para o grupo"}
						</PopoverTitle>
						<PopoverDescription className="text-[13px] leading-normal">
							Mande no grupo: quem clicar no link já entra.
						</PopoverDescription>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Fechar"
						className="-mt-1 -mr-1 size-7 text-muted-foreground"
						onClick={() => setOpen(false)}
					>
						<XIcon className="size-[15px]" />
					</Button>
				</div>

				{current ? (
					<QuickInviteCard quick={current} />
				) : createInvite.isError ? (
					<div className="flex flex-col items-start gap-3 rounded-xl border border-border p-4">
						<span className="text-[13px] text-muted-foreground">
							Não deu para criar o convite. {createInvite.error.message}
						</span>
						<Button size="sm" variant="secondary" onClick={create}>
							Tentar de novo
						</Button>
					</div>
				) : (
					<div className="flex h-[132px] items-center justify-center gap-2 rounded-xl border border-border text-[13px] text-muted-foreground">
						<Spinner />
						Criando o convite...
					</div>
				)}

				{canViewPanel && <MoreOptions onNavigate={() => setOpen(false)} />}
			</PopoverContent>
		</Popover>
	);
}

/** O bilhete e o Copiar link. Só existe com o popover aberto, então o relógio só anda aí. */
function QuickInviteCard({ quick }: { quick: QuickInviteValue }) {
	const { invite } = quick;
	const now = useNow(1000);
	const expired = now >= invite.expires_at * 1000;
	const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

	useEffect(() => {
		if (copy === "idle") return;
		const timer = setTimeout(() => setCopy("idle"), COPIED_MS);
		return () => clearTimeout(timer);
	}, [copy]);

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(invite.link);
			setCopy("copied");
		} catch {
			setCopy("failed");
		}
	}

	return (
		<>
			<InviteTicket
				size="compact"
				title="Para o grupo"
				url={inviteAddress(invite.link, invite.code)}
				code={invite.code}
				validity={`${expired ? "Venceu" : "Vence"} às ${expiryTime(invite.expires_at)}`}
				timeLeft={timeLeft(quick, now)}
				status={expired ? <InviteStatusPill status="expired" /> : undefined}
				count={invite.max_uses}
				countLabel={invite.max_uses === 1 ? "pessoa" : "pessoas"}
			/>
			<Button
				className="h-9"
				disabled={expired}
				onClick={() => void copyLink()}
			>
				{copy === "copied" ? <CheckIcon strokeWidth={2.5} /> : <CopyIcon />}
				{copy === "copied"
					? "Copiado"
					: copy === "failed"
						? "Não deu para copiar"
						: "Copiar link"}
			</Button>
		</>
	);
}

function MoreOptions({ onNavigate }: { onNavigate: () => void }) {
	const navigate = useNavigate();
	return (
		<div className="flex items-center justify-between gap-3 border-t border-border pt-3">
			<span className="text-xs text-foreground-subtle">
				Para uma pessoa ou do seu jeito?
			</span>
			<Button
				variant="link"
				className="gap-1 text-xs [&_svg:not([class*='size-'])]:size-3"
				onClick={() => {
					onNavigate();
					void navigate(paths.settings.invites);
				}}
			>
				Mais opções
				<ArrowRightIcon />
			</Button>
		</div>
	);
}

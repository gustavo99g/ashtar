import { Tabs } from "@base-ui/react/tabs";
import { PanelRightCloseIcon } from "lucide-react";
import { PeopleList, type PersonActions } from "@/features/chat";
import { DmButton, DmList } from "@/features/dms";
import {
	type SideContext,
	type SideTab,
	setSideOpen,
	setSideTab,
} from "../stores/sidePanelStore";
import { CountBadge } from "./CountBadge";

const TAB =
	"flex h-12 flex-1 items-center justify-center gap-[7px] text-[13px] font-semibold text-muted-foreground outline-none " +
	"hover:bg-secondary focus-visible:bg-secondary " +
	"data-active:text-foreground data-active:shadow-[inset_0_-2px_0_var(--color-primary)]";

/** O que o cartão de um membro ganha aqui: o botão que abre a conversa privada com ele. */
const memberActions: PersonActions = (person, close) => (
	<DmButton userId={person.id} onOpened={close} />
);

/**
 * A lateral aberta, como no quadro "Lateral — aba Membros": 300 de largura, as abas Membros e
 * Conversas no alto (48 de altura, a ativa com o traço azul embaixo) e o botão de minimizar.
 *
 * As abas são as do `@base-ui/react/tabs`, sem o visual segmentado do `components/ui/tabs`: as
 * setas trocam de aba e só o painel da ativa fica montado.
 */
export function SidePanel({
	context,
	tab,
	dmsUnread = 0,
}: {
	context: SideContext;
	tab: SideTab;
	/** As não lidas das conversas, ao lado do nome da aba. Chega na Etapa 13. */
	dmsUnread?: number;
}) {
	return (
		<Tabs.Root
			value={tab}
			onValueChange={(value) => setSideTab(value as SideTab)}
			render={<aside aria-label="Lateral" />}
			className="flex w-[300px] shrink-0 flex-col border-l border-border bg-card"
		>
			<div className="flex h-12 shrink-0 border-b border-border">
				<Tabs.List className="flex min-w-0 flex-1">
					<Tabs.Tab value="members" className={TAB}>
						Membros
					</Tabs.Tab>
					<Tabs.Tab value="dms" className={TAB}>
						Conversas
						<CountBadge count={dmsUnread} />
					</Tabs.Tab>
				</Tabs.List>
				<button
					type="button"
					aria-label="Minimizar lateral"
					title="Minimizar lateral"
					onClick={() => setSideOpen(context, false)}
					className="flex h-12 w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
				>
					<PanelRightCloseIcon aria-hidden="true" className="size-[18px]" />
				</button>
			</div>
			<Tabs.Panel value="members" className="flex min-h-0 flex-1 flex-col">
				<PeopleList actions={memberActions} />
			</Tabs.Panel>
			<Tabs.Panel value="dms" className="flex min-h-0 flex-1 flex-col">
				<DmList />
			</Tabs.Panel>
		</Tabs.Root>
	);
}

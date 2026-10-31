import { type ReactNode, useId, useState } from "react";
import type { CreatedInviteView } from "@/lib/api";
import { CreatedInvite } from "./CreatedInvite";
import { InviteForm } from "./InviteForm";

/*
 * Configurações › Painel de controle › Convites (quadros "Convites", "Convites (do seu jeito)" e
 * "Convites (convite criado)"). Só aparece no menu com `can_view_panel`; quem decide de verdade é
 * a API, que responde 403 a quem não pode.
 *
 * A página é um contêiner (`@container`): o formulário e o histórico se arrumam pela largura que
 * sobra ao lado do menu, e não pela janela.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-4">
			<h2
				id={id}
				className="text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase"
			>
				{title}
			</h2>
			{children}
		</section>
	);
}

export function InvitesSettings() {
	// O convite recém-criado. Só existe aqui: sair da tela esquece o código, que não volta.
	const [created, setCreated] = useState<CreatedInviteView | null>(null);

	return (
		<div className="@container flex w-full flex-col gap-8 py-20 pr-28 pl-32">
			<h1 className="text-[22px] leading-tight font-bold text-foreground">
				Convites
			</h1>
			<Section title="Novo convite">
				{created ? (
					<CreatedInvite
						invite={created}
						onCreateAnother={() => setCreated(null)}
					/>
				) : (
					<InviteForm onCreated={setCreated} />
				)}
			</Section>
		</div>
	);
}

import { CheckIcon, DownloadIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiUrl, type CreatedInviteView } from "@/lib/api";
import { useCopy } from "../hooks/useCopy";
import { CreatedInvite } from "./CreatedInvite";
import { InviteForm } from "./InviteForm";
import { InviteHistory } from "./InviteHistory";

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

/**
 * "Copiar link para baixar o app" (v0.9, decisão 9 do plano): o `/download` da API, que manda para
 * o instalador da última versão estável. É o que se manda para quem formatou ou trocou de PC: a
 * conta volta sozinha, sem convite nem recuperação.
 */
function DownloadLink() {
	const { copied, failed, copy } = useCopy();
	const done = copied === "download";
	return (
		<div className="flex flex-col items-end gap-1">
			<Button
				variant="secondary"
				onClick={() => void copy("download", apiUrl("/download"))}
			>
				{done ? (
					<CheckIcon aria-hidden="true" />
				) : (
					<DownloadIcon aria-hidden="true" />
				)}
				{done ? "Link copiado" : "Copiar link para baixar o app"}
			</Button>
			{failed && (
				<span role="alert" className="text-xs text-destructive-text">
					Não deu para copiar. Tente de novo.
				</span>
			)}
		</div>
	);
}

export function InvitesSettings() {
	// O convite recém-criado. Só existe aqui: sair da tela esquece o código, que não volta.
	const [created, setCreated] = useState<CreatedInviteView | null>(null);
	// O último criado ganha o selo "Novo" no histórico, mesmo depois do "Criar outro convite".
	const [newId, setNewId] = useState<string | null>(null);

	function onCreated(invite: CreatedInviteView) {
		setCreated(invite);
		setNewId(invite.id);
	}

	return (
		<div className="@container flex w-full flex-col gap-8 py-20 pr-28 pl-32">
			<div className="flex items-start justify-between gap-4">
				<h1 className="text-[22px] leading-tight font-bold text-foreground">
					Convites
				</h1>
				<DownloadLink />
			</div>
			<Section title="Novo convite">
				{created ? (
					<CreatedInvite
						invite={created}
						onCreateAnother={() => setCreated(null)}
					/>
				) : (
					<InviteForm onCreated={onCreated} />
				)}
			</Section>
			<InviteHistory newId={newId} />
		</div>
	);
}

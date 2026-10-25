import {
	EntryHeader,
	EntryScreen,
	OrPasteDivider,
	PasteInvite,
} from "@/features/entry";

/**
 * "Você precisa de um convite": o app abriu sem link (pelo menu Iniciar ou no fim da instalação)
 * e este computador nunca teve conta. Quem baixou pela página do convite já tem o link copiado.
 */
export function NoInviteRoute() {
	return (
		<EntryScreen labelledBy="sem-convite-titulo">
			<EntryHeader
				titleId="sem-convite-titulo"
				title="Você precisa de um convite"
				description="Peça o link ao dono do grupo e clique nele. O Ashtar abre sozinho, já com o convite."
			/>
			<OrPasteDivider />
			<PasteInvite
				label="Link ou código do convite"
				placeholder="https://… ou 7KQ2-M9XD-4HPA"
				description="Serve o link inteiro ou só o código. Se você baixou pela página do convite, o link já está copiado."
			/>
		</EntryScreen>
	);
}

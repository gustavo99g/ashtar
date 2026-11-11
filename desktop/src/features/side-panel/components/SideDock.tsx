import { useMatch } from "react-router-dom";
import { paths } from "@/lib/paths";
import { type SideContext, useSidePanel } from "../stores/sidePanelStore";
import { SidePanel } from "./SidePanel";
import { SideStrip } from "./SideStrip";

/**
 * A lateral direita do servidor (decisão 11 do `PLAN.md`, ADR 0021): aberta (`SidePanel`) ou
 * minimizada (`SideStrip`). Montada uma vez, no `AppShell`, ao lado da área do canal.
 *
 * Aparece no canal de texto e na sala de voz. Nas outras rotas da moldura (o redirecionamento do
 * `/server` e as configurações, que cobrem tudo) ela não é desenhada.
 */
export function SideDock() {
	const inText = useMatch(paths.channelPattern) !== null;
	const inVoice = useMatch(paths.voiceRoom) !== null;
	const context: SideContext | null = inText ? "text" : inVoice ? "voice" : null;
	if (!context) return null;
	return <Side context={context} />;
}

function Side({ context }: { context: SideContext }) {
	const { open, tab } = useSidePanel(context);
	return open ? (
		<SidePanel context={context} tab={tab} />
	) : (
		<SideStrip context={context} />
	);
}

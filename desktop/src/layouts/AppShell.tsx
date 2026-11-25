import { Outlet, useMatch } from "react-router-dom";
import { ActivitySync } from "@/features/activity";
import { CallBridge } from "@/features/calls";
import { ChannelDialogs } from "@/features/channels";
import { DmDock, showDm } from "@/features/dms";
import { useLoadEmojis } from "@/features/emojis";
import { ForwardDialog } from "@/features/forward";
import { LogsNotices } from "@/features/admin";
import { JoinNotices } from "@/features/members";
import { NotificationsBridge, RoomSounds } from "@/features/notifications";
import { ChannelNav, ServerMenu } from "@/features/server";
import { SideDock } from "@/features/side-panel";
import { MiniShare, VoiceDock } from "@/features/voice";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { ConnectionBanner } from "./ConnectionBanner";
/*
 * A moldura de quem já entrou: a coluna do servidor à esquerda, a rota no meio e a lateral
 * (membros e conversas) à direita. As
 * configurações também são filhas daqui e se desenham por cima de tudo (o `SettingsLayout` ocupa
 * a moldura inteira, com `absolute inset-0`), então a coluna continua montada embaixo delas.
 *
 * **Nenhum ancestral da rota pode ser posicionado** (`relative` e afins): o `inset-0` das
 * configurações se mede pelo ancestral posicionado mais perto, e um `relative` no `main` faria
 * elas cobrirem só a área do meio, com a coluna à mostra. Por isso a miniatura da transmissão tem a
 * própria camada, empilhada sobre o `main` na mesma célula da grade, e não dentro dele.
 *
 * A coluna vem da `features/server` (o nome do grupo com o menu de quem gerencia, `ServerMenu`, e
 * os canais, `ChannelNav`) e da
 * `features/voice` (no pé, o cartão de quem está usando, com o botão de configurações,
 * `VoiceDock`). A lateral vem da `features/side-panel` (`SideDock`): fica fora da célula do
 * `main`, então a área do canal, e com ela a camada da miniatura, encolhe quando a lateral abre. É
 * assim que os encaixes da miniatura contam com a lateral sem saber dela.
 *
 * A faixa "Sem conexão com o servidor" (`ConnectionBanner`) fica em cima de tudo, fora da parte
 * posicionada: as configurações abertas não a cobrem.
 */
export function AppShell() {
	// Os emojis do grupo: o texto, as reações e o seletor leem do store.
	useLoadEmojis();
	return (
		<div className="flex h-full flex-col">
			<ConnectionBanner />
			<AppFrame />
		</div>
	);
}

function AppFrame() {
	// Nas configurações, a camada da miniatura sobe por cima delas (v0.9): a transmissão assistida
	// continua à vista, em vez de parar até a pessoa sair.
	const inSettings = useMatch(`${paths.settings.root}/*`) !== null;
	return (
		<div className="relative flex min-h-0 flex-1">
			<aside
				aria-label="Servidor"
				className="flex w-[304px] shrink-0 flex-col bg-card"
			>
				<ServerMenu />
				<ChannelNav />
				<VoiceDock />
			</aside>
			<div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
				<main className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col">
					{/* O aviso de quem entrou (só para quem vê o Painel): vive enquanto a moldura vive. */}
					<JoinNotices />
					<LogsNotices />
					<Outlet />
				</main>
				{/* A transmissão assistida, em miniatura, quando a pessoa sai da sala. A camada tem o
				    tamanho do `main` e deixa o clique passar; só a miniatura o recebe. Nas
				    configurações, ela fica por cima delas (`z-40`). */}
				<div
					className={cn(
						"pointer-events-none relative col-start-1 row-start-1",
						inSettings && "z-40",
					)}
				>
					<MiniShare />
				</div>
				{/* As conversas privadas abertas, embaixo e encostadas na lateral: outra camada do
				    tamanho do `main`, por cima da miniatura. */}
				<div className="pointer-events-none relative col-start-1 row-start-1">
					<DmDock />
				</div>
			</div>
			<SideDock />
			{/* Os diálogos de criar, editar e arquivar canais: abrem pela lista ou pelo cabeçalho do chat. */}
			<ChannelDialogs />
			{/* O Encaminhar do menu da mensagem: escolher o canal ou a conversa. */}
			<ForwardDialog />
			{/* Os avisos: a regra, o ponto de não lido e o clique num cartão. Não desenha nada. */}
			<NotificationsBridge />
			<RoomSounds />
			<ActivitySync />
			{/* As ligações: a voz segue a ligação, e o cartão dela vai para a janela dos avisos. */}
			<CallBridge showConversation={showDm} />
		</div>
	);
}

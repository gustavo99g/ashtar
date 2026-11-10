import { Outlet } from "react-router-dom";
import logo from "@/assets/ashtar.svg";
import { ChannelDialogs } from "@/features/channels";
import { JoinNotices } from "@/features/members";
import { ChannelNav } from "@/features/server";
import { MiniShare, VoiceDock } from "@/features/voice";
/*
 * A moldura de quem já entrou: a coluna do servidor à esquerda e a rota no meio. As
 * configurações também são filhas daqui e se desenham por cima de tudo (o `SettingsLayout` ocupa
 * a moldura inteira, com `absolute inset-0`), então a coluna continua montada embaixo delas.
 *
 * **Nenhum ancestral da rota pode ser posicionado** (`relative` e afins): o `inset-0` das
 * configurações se mede pelo ancestral posicionado mais perto, e um `relative` no `main` faria
 * elas cobrirem só a área do meio, com a coluna à mostra. Por isso a miniatura da transmissão tem a
 * própria camada, empilhada sobre o `main` na mesma célula da grade, e não dentro dele.
 *
 * A coluna vem da `features/server` (a sala com quem está nela, `ChannelNav`) e da
 * `features/voice` (no pé, o cartão de quem está usando, com o botão de configurações,
 * `VoiceDock`).
 */
export function AppShell() {
	return (
		<div className="relative flex h-full">
			<aside
				aria-label="Servidor"
				className="flex w-[304px] shrink-0 flex-col bg-card"
			>
				<div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 text-[15px] font-bold">
					<img src={logo} alt="" className="size-7 rounded-lg" />
					Ashtar
				</div>
				<ChannelNav />
				<VoiceDock />
			</aside>
			<div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
				<main className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col">
					{/* O aviso de quem entrou (só para quem vê o Painel): vive enquanto a moldura vive. */}
					<JoinNotices />
					<Outlet />
				</main>
				{/* A transmissão assistida, em miniatura, quando a pessoa sai da sala. A camada tem o
				    tamanho do `main` e deixa o clique passar; só a miniatura o recebe. */}
				<div className="pointer-events-none relative col-start-1 row-start-1">
					<MiniShare />
				</div>
			</div>
			{/* Os diálogos de criar, editar e arquivar canais: abrem pela lista ou pelo cabeçalho do chat. */}
			<ChannelDialogs />
		</div>
	);
}

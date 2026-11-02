import { Outlet } from "react-router-dom";
import logo from "@/assets/ashtar.svg";
import { ChannelDialogs } from "@/features/channels";
import { JoinNotices } from "@/features/members";
import { ChannelNav } from "@/features/server";
import { VoiceDock } from "@/features/voice";
/*
 * A moldura de quem já entrou: a coluna do servidor à esquerda e a rota no meio. As
 * configurações também são filhas daqui e se desenham por cima de tudo (o `SettingsLayout` ocupa
 * a moldura inteira), então a coluna continua montada embaixo delas.
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
			<main className="flex min-w-0 flex-1 flex-col">
				{/* O aviso de quem entrou (só para quem vê o Painel): vive enquanto a moldura vive. */}
				<JoinNotices />
				<Outlet />
			</main>
			{/* Os diálogos de criar, editar e arquivar canais: abrem pela lista ou pelo cabeçalho do chat. */}
			<ChannelDialogs />
		</div>
	);
}

import { Outlet } from "react-router-dom";
import logo from "@/assets/ashtar.svg";
import { ChannelNav, VoiceDock } from "@/features/voice";
/*
 * A moldura de quem já entrou: a coluna do servidor à esquerda e a rota no meio. As
 * configurações também são filhas daqui e se desenham por cima de tudo (o `SettingsLayout` ocupa
 * a moldura inteira), então a coluna continua montada embaixo delas.
 *
 * A coluna vem da `features/voice`: a sala com quem está nela (`ChannelNav`) e, no pé, o
 * cartão de quem está usando, com o botão de configurações (`VoiceDock`).
 */
export function AppShell() {
	return (
		<div className="relative flex h-full">
			<aside className="flex w-60 shrink-0 flex-col bg-card">
				<div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 text-[15px] font-bold">
					<img src={logo} alt="" className="size-7 rounded-lg" />
					Ashtar
				</div>
				<ChannelNav />
				<VoiceDock />
			</aside>
			<main className="flex min-w-0 flex-1 flex-col">
				<Outlet />
			</main>
		</div>
	);
}

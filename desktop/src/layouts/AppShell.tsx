import { SettingsIcon } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import logo from "@/assets/ashtar.svg";
import { paths } from "@/lib/paths";

/*
 * A moldura de quem já entrou: a coluna do servidor à esquerda e a rota no meio. As
 * configurações também são filhas daqui e se desenham por cima de tudo (o `SettingsLayout` ocupa
 * a moldura inteira), então a coluna continua montada embaixo delas.
 *
 * A Etapa 5 preenche a coluna: a lista da sala, o painel "Voz conectada" e o cartão de quem está
 * usando (avatar, nick, microfone e áudio) em volta do botão de configurações.
 */
export function AppShell() {
	return (
		<div className="relative flex h-full">
			<aside className="flex w-60 shrink-0 flex-col bg-card">
				<div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 text-[15px] font-bold">
					<img src={logo} alt="" className="size-7 rounded-lg" />
					Ashtar
				</div>
				<nav aria-label="Salas" className="flex-1" />
				<div className="shrink-0 px-2 pb-2">
					<div className="flex h-[70px] items-center justify-end rounded-xl border border-border bg-secondary pr-1.5 pl-2.5">
						<Link
							to={paths.settings.profile}
							aria-label="Configurações"
							className="flex h-8 w-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<SettingsIcon className="size-5" strokeWidth={1.8} />
						</Link>
					</div>
				</div>
			</aside>
			<main className="flex min-w-0 flex-1 flex-col">
				<Outlet />
			</main>
		</div>
	);
}

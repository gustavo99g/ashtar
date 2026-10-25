import { Outlet } from "react-router-dom";
import { LinkWatcher } from "@/features/entry";
import { TitleBar } from "./TitleBar";

/**
 * O que toda tela tem: a barra de título em cima e a rota embaixo, ocupando o resto da janela.
 * O `LinkWatcher` fica aqui para escutar o link `ashtar://` em qualquer tela.
 */
export function RootLayout() {
	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<TitleBar />
			<LinkWatcher />
			<div className="relative min-h-0 flex-1">
				<Outlet />
			</div>
		</div>
	);
}

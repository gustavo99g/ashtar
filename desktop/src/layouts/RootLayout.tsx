import { Outlet } from "react-router-dom";
import { TitleBar } from "./TitleBar";

/**
 * O que toda tela tem: a barra de título em cima e a rota embaixo, ocupando o resto da janela.
 */
export function RootLayout() {
	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<TitleBar />
			<div className="relative min-h-0 flex-1">
				<Outlet />
			</div>
		</div>
	);
}

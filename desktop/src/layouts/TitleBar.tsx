import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import logo from "@/assets/ashtar.svg";
import {
	closeWindow,
	minimizeWindow,
	toggleMaximizeWindow,
	watchWindowMaximized,
} from "@/lib/tauri/window";
import { cn } from "@/lib/utils";

/*
 * A barra de título própria, igual em todas as telas do canvas. Arrastar pela barra move a
 * janela e dois cliques maximizam (o Tauri faz isso pelo `data-tauri-drag-region`). Com
 * `decorations: false`, o menu de encaixe do Windows 11 (mouse parado no Maximizar) não aparece;
 * arrastar até a borda e o Win + setas continuam funcionando.
 */

function WindowButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn(
				"flex h-titlebar w-[46px] items-center justify-center text-muted-foreground transition-colors",
				"[&>svg]:size-3 [&>svg]:stroke-[2.5]",
				className,
			)}
			{...props}
		/>
	);
}

export function TitleBar() {
	const [maximized, setMaximized] = useState(false);

	useEffect(() => watchWindowMaximized(setMaximized), []);

	return (
		// O atributo sem valor só vale para cliques no próprio elemento: por isso o logo e o nome
		// ignoram o mouse (`pointer-events-none`) e o clique cai na barra.
		<header
			data-tauri-drag-region
			className="flex h-titlebar shrink-0 items-center gap-2 border-b border-border bg-rail pl-3 select-none"
		>
			<img
				src={logo}
				alt=""
				className="pointer-events-none size-4 rounded-sm"
			/>
			<span className="pointer-events-none grow text-xs font-semibold text-muted-foreground">
				Ashtar
			</span>
			<WindowButton
				aria-label="Minimizar"
				onClick={minimizeWindow}
				className="hover:bg-secondary hover:text-foreground"
			>
				<MinusIcon />
			</WindowButton>
			<WindowButton
				aria-label={maximized ? "Restaurar" : "Maximizar"}
				onClick={toggleMaximizeWindow}
				className="hover:bg-secondary hover:text-foreground"
			>
				{maximized ? <CopyIcon className="-scale-x-100" /> : <SquareIcon />}
			</WindowButton>
			<WindowButton
				aria-label="Fechar"
				onClick={closeWindow}
				className="hover:bg-destructive hover:text-destructive-foreground"
			>
				<XIcon />
			</WindowButton>
		</header>
	);
}

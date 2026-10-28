import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { ArrowRightIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * O aviso no canto (toast) do canvas, com a barra de tempo dourada.
 *
 * A barra é o relógio: o Base UI fica sem prazo (`timeout={0}`) e o aviso fecha quando a
 * animação da barra termina. Assim a barra e o fechamento nunca se desencontram. A animação
 * pausa com o mouse ou o foco do teclado em cima (`data-expanded` do Base UI) e com a janela
 * fora de foco: quem está no jogo vê o aviso quando voltar. Com "reduzir movimento" ligado no
 * Windows, a barra some, mas o tempo continua contando.
 */

/** Quanto o aviso fica na tela, como no canvas. */
const TOAST_DURATION_MS = 8000;

interface ToastData {
	/** O que fica à esquerda: o avatar de quem entrou, ou um ícone. */
	media?: ReactNode;
}

/**
 * Gerenciador global, que funciona fora do React também:
 * `toast.add({ title, description, data: { media }, actionProps: { children, onClick } })`.
 * Não passe `timeout`: o tempo é o da barra.
 */
const toast = ToastPrimitive.createToastManager<ToastData>();

function useWindowFocused() {
	const [focused, setFocused] = useState(() => document.hasFocus());

	useEffect(() => {
		const onFocus = () => setFocused(true);
		const onBlur = () => setFocused(false);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	return focused;
}

function ToastTimer({ onDone }: { onDone: () => void }) {
	const windowFocused = useWindowFocused();

	return (
		<span
			aria-hidden="true"
			data-slot="toast-timer"
			data-paused={windowFocused ? undefined : ""}
			onAnimationEnd={onDone}
			style={{ animationDuration: `${TOAST_DURATION_MS}ms` }}
			className={cn(
				"absolute inset-x-0 bottom-0 h-0.5 origin-left bg-gold opacity-55 animate-toast-timer",
				"group-data-expanded/toast:[animation-play-state:paused] data-paused:[animation-play-state:paused]",
				"motion-reduce:opacity-0",
			)}
		/>
	);
}

function ToastItem({
	item,
}: {
	item: ToastPrimitive.Root.ToastObject<ToastData>;
}) {
	const { close } = ToastPrimitive.useToastManager();

	return (
		<ToastPrimitive.Root
			toast={item}
			data-slot="toast"
			className={cn(
				"group/toast relative w-full overflow-hidden rounded-2xl border border-border-strong bg-popover py-3.5 pr-3 pl-3.5 text-popover-foreground shadow-toast select-none",
				"transition-[opacity,translate,scale] duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
				"data-starting-style:translate-y-2 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
				"data-ending-style:translate-x-4 data-ending-style:opacity-0 data-limited:hidden",
			)}
		>
			<ToastPrimitive.Content className="flex items-start gap-3">
				{item.data?.media && (
					<span className="flex shrink-0">{item.data.media}</span>
				)}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
					<ToastPrimitive.Title className="text-sm text-foreground" />
					<ToastPrimitive.Description className="text-xs leading-[1.45] text-muted-foreground" />
					<ToastPrimitive.Action className="mt-[5px] flex items-center gap-1 self-start text-xs font-semibold text-link hover:text-link-hover">
						{item.actionProps?.children}
						<ArrowRightIcon className="size-3" />
					</ToastPrimitive.Action>
				</div>
				<ToastPrimitive.Close
					aria-label="Fechar aviso"
					className="-mt-1 -mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</ToastPrimitive.Close>
			</ToastPrimitive.Content>
			<ToastTimer key={item.updateKey} onDone={() => close(item.id)} />
		</ToastPrimitive.Root>
	);
}

function ToastList() {
	const { toasts } = ToastPrimitive.useToastManager<ToastData>();
	return toasts.map((item) => <ToastItem key={item.id} item={item} />);
}

/** Fica uma vez na raiz do app (`app/App.tsx`). */
function Toaster({ children }: { children?: ReactNode }) {
	return (
		<ToastPrimitive.Provider toastManager={toast} timeout={0} limit={3}>
			{children}
			<ToastPrimitive.Portal>
				<ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-50 flex w-[380px] max-w-[calc(100%-2rem)] flex-col-reverse gap-2 outline-none">
					<ToastList />
				</ToastPrimitive.Viewport>
			</ToastPrimitive.Portal>
		</ToastPrimitive.Provider>
	);
}

export { Toaster, toast };

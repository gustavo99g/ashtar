import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
	ArrowRightIcon,
	CheckIcon,
	CircleXIcon,
	InfoIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * O aviso no canto (toast) do canvas, com a barra de tempo dourada.
 *
 * A barra é o relógio: o Base UI fica sem prazo (`timeout={0}`) e o aviso fecha quando a
 * animação da barra termina. Assim a barra e o fechamento nunca se desencontram. A animação
 * pausa com o mouse ou o foco do teclado em cima (`data-expanded` do Base UI) e com a janela
 * minimizada: quem minimizou o Ashtar vê o aviso quando voltar. Atrás de outra janela (o jogo na
 * frente, o Ashtar no outro monitor), conta normal, para os avisos não se acumularem. Com "reduzir movimento" ligado no
 * Windows, a barra some, mas o tempo continua contando.
 */

/** Quanto o aviso fica na tela, como no canvas. O erro fica mais, para dar tempo de ler o motivo. */
const TOAST_DURATION_MS = 8000;
const ERROR_DURATION_MS = 12000;
const COMPACT_DURATION_MS = 4000;

/**
 * O tipo do aviso (o quadro "Avisos — tipos"): o ícone à esquerda e a cor da barra de tempo dizem de
 * relance se deu certo, se deu errado, se pede atenção ou se é só para saber.
 */
export type ToastTone = "success" | "error" | "warning" | "info";

const TONES: Record<
	ToastTone,
	{ icon: ReactNode; badge: string; bar: string }
> = {
	success: {
		icon: <CheckIcon />,
		badge: "bg-success-subtle text-success-text",
		bar: "bg-success",
	},
	error: {
		icon: <CircleXIcon />,
		badge: "bg-destructive-subtle text-destructive-text",
		bar: "bg-destructive",
	},
	warning: {
		icon: <TriangleAlertIcon />,
		badge: "bg-warning-subtle text-warning-text",
		bar: "bg-warning",
	},
	info: {
		icon: <InfoIcon />,
		badge: "bg-info-subtle text-info-text",
		bar: "bg-primary",
	},
};

interface ToastData {
	/** O que fica à esquerda no lugar do ícone do tipo: o avatar de quem entrou, ou outro ícone. */
	media?: ReactNode;
	/** O tipo: o ícone (sem `media`) e a cor da barra. Sem tipo, a barra é dourada. */
	tone?: ToastTone;
	/** A confirmação curta ("Imagem copiada"): uma linha só, e some em 4 s. */
	compact?: boolean;
}

/**
 * Gerenciador global, que funciona fora do React também:
 * `toast.add({ title, description, data: { tone, media, compact }, actionProps: { children, onClick } })`.
 * Não passe `timeout`: o tempo é o da barra.
 */
const toast = ToastPrimitive.createToastManager<ToastData>();

/** Se a janela está à vista: `false` só minimizada (ou escondida na bandeja). */
function useWindowVisible() {
	const [visible, setVisible] = useState(
		() => document.visibilityState !== "hidden",
	);

	useEffect(() => {
		const onChange = () =>
			setVisible(document.visibilityState !== "hidden");
		document.addEventListener("visibilitychange", onChange);
		return () => document.removeEventListener("visibilitychange", onChange);
	}, []);

	return visible;
}

function ToastTimer({
	onDone,
	duration,
	bar,
}: {
	onDone: () => void;
	duration: number;
	bar: string;
}) {
	const windowVisible = useWindowVisible();

	return (
		<span
			aria-hidden="true"
			data-slot="toast-timer"
			data-paused={windowVisible ? undefined : ""}
			onAnimationEnd={onDone}
			style={{ animationDuration: `${duration}ms` }}
			className={cn(
				"absolute inset-x-0 bottom-0 h-0.5 origin-left opacity-55 animate-toast-timer",
				bar,
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
	const tone = item.data?.tone ? TONES[item.data.tone] : null;
	const compact = item.data?.compact === true;
	const duration = compact
		? COMPACT_DURATION_MS
		: item.data?.tone === "error"
			? ERROR_DURATION_MS
			: TOAST_DURATION_MS;
	const media =
		item.data?.media ??
		(tone && (
			<span
				aria-hidden="true"
				className={cn(
					"flex shrink-0 items-center justify-center",
					compact
						? "size-[22px] rounded-[7px] [&_svg]:size-[13px]"
						: "size-9 rounded-[10px] [&_svg]:size-[18px]",
					tone.badge,
				)}
			>
				{tone.icon}
			</span>
		));

	return (
		<ToastPrimitive.Root
			toast={item}
			data-slot="toast"
			data-tone={item.data?.tone}
			className={cn(
				"group/toast relative overflow-hidden border border-border-strong bg-popover text-popover-foreground shadow-toast select-none",
				compact
					? "w-fit max-w-full self-end rounded-xl py-2 pr-3.5 pl-2.5"
					: "w-full rounded-2xl py-3.5 pr-3 pl-3.5",
				"transition-[opacity,translate,scale] duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
				"data-starting-style:translate-y-2 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
				"data-ending-style:translate-x-4 data-ending-style:opacity-0 data-limited:hidden",
			)}
		>
			<ToastPrimitive.Content
				className={cn(
					"flex gap-3",
					compact ? "items-center gap-2" : "items-start",
				)}
			>
				{media && <span className="flex shrink-0">{media}</span>}
				<div
					className={cn(
						"flex min-w-0 flex-1 gap-0.5",
						compact ? "items-center gap-3" : "flex-col pt-px",
					)}
				>
					<ToastPrimitive.Title
						className={cn(
							"font-semibold text-foreground",
							compact ? "text-[13px]" : "text-sm",
						)}
					/>
					{!compact && (
						<ToastPrimitive.Description className="text-xs leading-[1.45] text-muted-foreground" />
					)}
					{/* Sem ação, nada de setinha sozinha. Na curta, a ação fica na mesma linha. */}
					{item.actionProps?.children && (
						<ToastPrimitive.Action
							className={cn(
								"flex shrink-0 items-center gap-1 self-start text-xs font-semibold whitespace-nowrap text-link hover:text-link-hover",
								compact ? "self-center" : "mt-[5px]",
							)}
						>
							{item.actionProps.children}
							<ArrowRightIcon className="size-3" />
						</ToastPrimitive.Action>
					)}
				</div>
				{!compact && (
					<ToastPrimitive.Close
						aria-label="Fechar aviso"
						className="-mt-1 -mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<XIcon className="size-3.5" />
					</ToastPrimitive.Close>
				)}
			</ToastPrimitive.Content>
			<ToastTimer
				key={item.updateKey}
				duration={duration}
				bar={tone?.bar ?? "bg-gold"}
				onDone={() => close(item.id)}
			/>
		</ToastPrimitive.Root>
	);
}

function ToastList() {
	const { toasts } = ToastPrimitive.useToastManager<ToastData>();
	return toasts.map((item) => <ToastItem key={item.id} item={item} />);
}

/**
 * Fica uma vez na raiz do app (`app/App.tsx`). `raised`: numa chamada, os avisos sobem para
 * acima da barra da sala (Microfone, Áudio, Tela), como o aviso de atualização.
 */
function Toaster({
	children,
	raised = false,
}: {
	children?: ReactNode;
	raised?: boolean;
}) {
	return (
		<ToastPrimitive.Provider toastManager={toast} timeout={0} limit={3}>
			{children}
			<ToastPrimitive.Portal>
				<ToastPrimitive.Viewport
					className={cn(
						"fixed right-4 z-50 flex w-[380px] max-w-[calc(100%-2rem)] flex-col-reverse gap-2 outline-none",
						raised ? "bottom-[94px]" : "bottom-4",
					)}
				>
					<ToastList />
				</ToastPrimitive.Viewport>
			</ToastPrimitive.Portal>
		</ToastPrimitive.Provider>
	);
}

export { Toaster, toast };

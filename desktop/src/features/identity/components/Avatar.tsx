import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { avatarInitial, nickColor } from "../model/nickColor";

/*
 * O avatar do canvas: um círculo na cor do nick com a letra do nome. Não há foto na 0.2.2.
 * O tamanho vem em pixels porque o canvas usa muitos (22, 32, 36, 40, 52, 64, 72...); a letra
 * fica com uns 40% dele.
 */

interface AvatarProps extends Omit<ComponentProps<"span">, "children"> {
	nick: string;
	/** O nome visível. Sem ele, a letra sai do nick. */
	displayName?: string | null;
	/** Lado em pixels. */
	size?: number;
	/** O selo no canto, com `AvatarBadge`. */
	badge?: ReactNode;
}

function Avatar({
	nick,
	displayName,
	size = 36,
	badge,
	className,
	style,
	...props
}: AvatarProps) {
	return (
		<span
			aria-hidden="true"
			data-slot="avatar"
			className={cn(
				"relative flex shrink-0 items-center justify-center rounded-full font-bold select-none",
				className,
			)}
			style={{
				width: size,
				height: size,
				fontSize: Math.max(10, Math.round(size * 0.39)),
				backgroundColor: nickColor(nick),
				// A letra é sempre branca: as oito cores da paleta foram escolhidas para isso.
				color: "#ffffff",
				...style,
			}}
			{...props}
		>
			{avatarInitial(nick, displayName)}
			{badge}
		</span>
	);
}

/**
 * O selo dourado no canto do avatar (o bilhete do convite, a chave da recuperação, a coroa do
 * dono). A borda tem a cor do fundo em volta: troque `border-popover` pela do lugar onde ele fica.
 */
function AvatarBadge({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			data-slot="avatar-badge"
			className={cn(
				"absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full border-2 border-popover bg-gold-subtle text-gold",
				"[&>svg]:size-[9px] [&>svg]:stroke-[2.5]",
				className,
			)}
			{...props}
		/>
	);
}

export { Avatar, AvatarBadge };

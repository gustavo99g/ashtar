/**
 * O cartão que abre ao passar o mouse (o `PreviewCard` do Base UI), com o mesmo visual do popover.
 * Some quando o mouse sai do gatilho e do próprio cartão.
 */
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { cn } from "@/lib/utils";

function PreviewCard(props: PreviewCardPrimitive.Root.Props) {
	return <PreviewCardPrimitive.Root data-slot="preview-card" {...props} />;
}

function PreviewCardTrigger({
	delay = 300,
	...props
}: PreviewCardPrimitive.Trigger.Props) {
	return (
		<PreviewCardPrimitive.Trigger
			data-slot="preview-card-trigger"
			delay={delay}
			{...props}
		/>
	);
}

function PreviewCardContent({
	className,
	side = "right",
	sideOffset = 8,
	align = "center",
	...props
}: PreviewCardPrimitive.Popup.Props &
	Pick<
		PreviewCardPrimitive.Positioner.Props,
		"side" | "sideOffset" | "align"
	>) {
	return (
		<PreviewCardPrimitive.Portal>
			<PreviewCardPrimitive.Positioner
				side={side}
				sideOffset={sideOffset}
				align={align}
				className="isolate z-50"
			>
				<PreviewCardPrimitive.Popup
					data-slot="preview-card-content"
					className={cn(
						"flex w-72 origin-(--transform-origin) flex-col gap-3 rounded-xl border border-border-strong bg-popover p-3 text-sm text-popover-foreground shadow-popover outline-hidden",
						"duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				/>
			</PreviewCardPrimitive.Positioner>
		</PreviewCardPrimitive.Portal>
	);
}

export { PreviewCard, PreviewCardContent, PreviewCardTrigger };

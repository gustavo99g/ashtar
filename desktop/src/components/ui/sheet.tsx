import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/*
 * A gaveta lateral (o detalhe do membro, por exemplo). É um Dialog do Base UI preso à direita,
 * abaixo da barra de título.
 */

function Sheet(props: SheetPrimitive.Root.Props) {
	return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
	return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: SheetPrimitive.Close.Props) {
	return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
	className,
	children,
	showCloseButton = true,
	...props
}: SheetPrimitive.Popup.Props & { showCloseButton?: boolean }) {
	return (
		<SheetPrimitive.Portal>
			<SheetPrimitive.Backdrop
				data-slot="sheet-overlay"
				className="fixed inset-x-0 top-titlebar bottom-0 z-40 bg-overlay duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
			/>
			<SheetPrimitive.Popup
				data-slot="sheet-content"
				className={cn(
					"fixed top-titlebar right-0 bottom-0 z-50 flex w-[420px] max-w-full flex-col border-l border-border-strong bg-card text-card-foreground shadow-drawer",
					"duration-200 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<SheetPrimitive.Close
						data-slot="sheet-close"
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								className="absolute top-4 right-4"
							/>
						}
					>
						<XIcon />
						<span className="sr-only">Fechar</span>
					</SheetPrimitive.Close>
				)}
			</SheetPrimitive.Popup>
		</SheetPrimitive.Portal>
	);
}

function SheetHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-header"
			className={cn(
				"flex flex-col gap-1.5 border-b border-border p-6 pr-14",
				className,
			)}
			{...props}
		/>
	);
}

function SheetBody({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-body"
			className={cn("flex-1 overflow-y-auto p-6", className)}
			{...props}
		/>
	);
}

function SheetFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn("flex gap-2 border-t border-border p-6", className)}
			{...props}
		/>
	);
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
	return (
		<SheetPrimitive.Title
			data-slot="sheet-title"
			className={cn("text-[17px] font-bold text-foreground", className)}
			{...props}
		/>
	);
}

function SheetDescription({
	className,
	...props
}: SheetPrimitive.Description.Props) {
	return (
		<SheetPrimitive.Description
			data-slot="sheet-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Sheet,
	SheetBody,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
};

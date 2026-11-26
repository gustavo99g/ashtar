import { XIcon } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { EmojiPicker } from "@/features/emojis";
import { SoundEmoji } from "./SoundEmoji";

/**
 * O emoji do som: o botão mostra o escolhido (ou o 🔊 apagado, que é o que aparece sem emoji) e abre
 * o seletor do chat, com os emojis do grupo. O X tira o emoji.
 */
export function EmojiChoice({
	value,
	onChange,
}: {
	value: string;
	onChange: (emoji: string) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="relative">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					aria-label={value ? "Trocar o emoji do som" : "Escolher o emoji do som"}
					title="Escolher o emoji"
					className="flex size-9 items-center justify-center rounded-md border border-input bg-transparent text-lg hover:bg-accent data-popup-open:bg-accent"
				>
					{value ? (
						<SoundEmoji emoji={value} className="size-6" />
					) : (
						<span className="opacity-40">🔊</span>
					)}
				</PopoverTrigger>
				<PopoverContent
					side="top"
					align="start"
					className="w-auto gap-0 p-0 data-open:zoom-in-100 data-closed:hidden"
				>
					<EmojiPicker
						onPick={(picked) => {
							onChange(picked);
							setOpen(false);
						}}
					/>
				</PopoverContent>
			</Popover>
			{value && (
				<button
					type="button"
					aria-label="Tirar o emoji"
					onClick={() => onChange("")}
					className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
				>
					<XIcon className="size-3" />
				</button>
			)}
		</div>
	);
}

import { useId } from "react";
import { Switch } from "@/components/ui/switch";

/** Uma linha de Configurações com título, explicação e a chave. */
export function SettingSwitch({
	title,
	description,
	checked,
	onCheckedChange,
}: {
	title: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	const labelId = useId();
	return (
		<div className="flex items-center justify-between gap-6 border-b border-border py-3">
			<span className="flex flex-col gap-[3px]">
				<span id={labelId} className="text-sm font-medium text-foreground">
					{title}
				</span>
				<span className="text-xs text-muted-foreground">{description}</span>
			</span>
			<Switch
				checked={checked}
				onCheckedChange={onCheckedChange}
				aria-labelledby={labelId}
				variant={"blue"}
			/>
		</div>
	);
}

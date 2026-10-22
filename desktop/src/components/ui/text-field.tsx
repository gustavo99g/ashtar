import { CircleAlertIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Label } from "./label";

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, "id"> {
	label: string;
	/** Ajuda embaixo do campo. Some quando há erro. */
	description?: ReactNode;
	/** Mensagem de erro. Com ela, o campo fica vermelho e o leitor de tela anuncia o problema. */
	error?: ReactNode;
	/** Algo dentro do campo, à esquerda (um ícone ou a prévia do avatar), com 26px. */
	leading?: ReactNode;
	/** Mostra o contador de caracteres ("3/32") ao lado do rótulo. */
	showCount?: boolean;
}

/** Campo de texto do canvas: rótulo, contador, campo, ajuda ou erro. */
function TextField({
	label,
	description,
	error,
	leading,
	showCount = false,
	className,
	value,
	defaultValue,
	maxLength,
	onChange,
	...props
}: TextFieldProps) {
	const id = useId();
	const helpId = `${id}-help`;
	const [typedLength, setTypedLength] = useState(
		String(defaultValue ?? "").length,
	);
	const length = value === undefined ? typedLength : String(value).length;
	const help = error ?? description;

	return (
		<div
			data-slot="text-field"
			className={cn("flex flex-col gap-2", className)}
		>
			<div className="flex items-baseline justify-between">
				<Label htmlFor={id}>{label}</Label>
				{showCount && maxLength !== undefined && (
					<span className="font-mono text-[11px] text-muted-foreground">
						{length}/{maxLength}
					</span>
				)}
			</div>
			<div className="relative">
				{leading && (
					<span
						aria-hidden="true"
						className="pointer-events-none absolute top-[9px] left-[9px] flex size-[26px] items-center justify-center"
					>
						{leading}
					</span>
				)}
				<Input
					id={id}
					value={value}
					defaultValue={defaultValue}
					maxLength={maxLength}
					aria-invalid={error ? true : undefined}
					aria-describedby={help ? helpId : undefined}
					className={cn(leading && "pl-11")}
					onChange={(event) => {
						setTypedLength(event.target.value.length);
						onChange?.(event);
					}}
					{...props}
				/>
			</div>
			{help && (
				<p
					id={helpId}
					className={cn(
						"flex items-start gap-1.5 text-xs leading-snug",
						error ? "text-destructive-text" : "text-muted-foreground",
					)}
				>
					{error && (
						<CircleAlertIcon className="mt-px size-3.5 shrink-0 text-destructive-border" />
					)}
					{help}
				</p>
			)}
		</div>
	);
}

export { TextField };

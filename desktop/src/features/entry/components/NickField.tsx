import { UserIcon } from "lucide-react";
import { TextField } from "@/components/ui/text-field";
import { Avatar } from "@/features/identity";
import { checkNick, NICK_MAX } from "@/features/identity";

interface NickFieldProps {
	value: string;
	onChange: (value: string) => void;
	/** A recusa da API (nick em uso, nick inválido). O erro das regras do app vem antes. */
	rejection: string | null;
}

/**
 * O campo do nick: o avatar com a cor e a letra do nick enquanto a pessoa digita, o contador e
 * a ajuda que muda com o que foi digitado.
 */
export function NickField({ value, onChange, rejection }: NickFieldProps) {
	const check = checkNick(value);

	return (
		<TextField
			label="Nick"
			placeholder="Escolha um nick"
			description={check.hint}
			error={check.error ?? rejection}
			leading={
				check.nick === "" ? (
					<span className="flex size-full items-center justify-center rounded-full bg-secondary text-foreground-subtle">
						<UserIcon className="size-3.5" strokeWidth={2.25} />
					</span>
				) : (
					// A cor sai do nick sem espaços nas pontas, como a API vai gravar.
					<Avatar nick={check.nick} size={26} style={{ fontSize: 12 }} />
				)
			}
			value={value}
			maxLength={NICK_MAX}
			showCount
			onChange={(event) => onChange(event.target.value)}
			autoComplete="off"
			spellCheck={false}
		/>
	);
}

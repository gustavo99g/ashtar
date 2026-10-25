import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { invitePath } from "../destination";
import { parseInviteLink } from "../inviteLink";

interface PasteInviteProps {
	label: string;
	placeholder: string;
	description: string;
}

/**
 * O campo de colar o link ou o código, com o Continuar. Um convite que o app reconhece vai para a
 * tela dele (nick ou recuperação), onde a API confere se ainda vale; o resto fica no campo.
 */
export function PasteInvite({
	label,
	placeholder,
	description,
}: PasteInviteProps) {
	const navigate = useNavigate();
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);

	function submit(event: FormEvent) {
		event.preventDefault();
		if (text.trim() === "") {
			setError("Cole o link ou o código.");
			return;
		}
		const link = parseInviteLink(text);
		if (link === null) {
			setError("Isso não parece um link ou código de convite.");
			return;
		}
		void navigate(invitePath(link), { replace: true });
	}

	return (
		<form noValidate onSubmit={submit} className="flex flex-col gap-6">
			<TextField
				label={label}
				placeholder={placeholder}
				description={description}
				error={error}
				value={text}
				onChange={(event) => {
					setText(event.target.value);
					setError(null);
				}}
				autoComplete="off"
				spellCheck={false}
			/>
			<Button type="submit" size="lg" className="w-full">
				Continuar
			</Button>
		</form>
	);
}

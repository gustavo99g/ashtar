/*
 * "Quem tem acesso" no diálogo de criar e de editar canal (ADR 0028): a chave "Restrito" e, ligada,
 * a lista de membros para marcar, com uma busca. O dono e quem gerencia os canais têm acesso mesmo
 * fora da lista, e o texto diz isso.
 */
import { LockIcon, SearchIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePeople } from "@/features/chat";

export type AccessValue = { restricted: boolean; memberIds: string[] };

/** A partir de quantas pessoas a busca aparece. */
const SEARCH_FROM = 8;

export function ChannelAccess({
	value,
	onChange,
	room,
}: {
	value: AccessValue;
	onChange: (value: AccessValue) => void;
	/** Sala de voz: muda só o texto. */
	room: boolean;
}) {
	const labelId = useId();
	const people = usePeople().data ?? [];
	const [query, setQuery] = useState("");
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		const sorted = [...people].sort((a, b) =>
			(a.display_name ?? a.nick).localeCompare(b.display_name ?? b.nick),
		);
		if (!q) return sorted;
		return sorted.filter(
			(person) =>
				person.nick.toLowerCase().includes(q) ||
				person.display_name?.toLowerCase().includes(q),
		);
	}, [people, query]);
	const selected = new Set(value.memberIds);

	function toggle(id: string, on: boolean) {
		const next = new Set(selected);
		if (on) next.add(id);
		else next.delete(id);
		onChange({ ...value, memberIds: [...next] });
	}

	return (
		<section className="flex flex-col gap-3" aria-label="Quem tem acesso">
			<div className="flex items-center justify-between gap-6">
				<span className="flex flex-col gap-[3px]">
					<span
						id={labelId}
						className="flex items-center gap-1.5 text-sm font-medium text-foreground"
					>
						<LockIcon aria-hidden="true" className="size-3.5" />
						Restrito
					</span>
					<span className="text-xs text-muted-foreground">
						{room
							? "Só quem estiver na lista vê e entra na sala."
							: "Só quem estiver na lista vê e escreve no canal."}
					</span>
				</span>
				<Switch
					checked={value.restricted}
					onCheckedChange={(restricted) => onChange({ ...value, restricted })}
					aria-labelledby={labelId}
					variant="blue"
				/>
			</div>
			{value.restricted && (
				<div className="flex flex-col gap-2">
					<span className="text-xs text-muted-foreground">
						Quem gerencia os canais também tem acesso, mesmo fora da lista.
					</span>
					{people.length >= SEARCH_FROM && (
						<div className="relative">
							<SearchIcon
								aria-hidden="true"
								className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								aria-label="Buscar membro"
								placeholder="Buscar"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								className="h-9 pl-9 text-[13px]"
							/>
						</div>
					)}
					<ul
						aria-label="Membros"
						className="flex max-h-[200px] flex-col overflow-y-auto rounded-lg border border-border"
					>
						{shown.map((person) => (
							<li key={person.id}>
								<label className="flex h-9 cursor-pointer items-center gap-2.5 px-3 text-[13px] text-foreground hover:bg-secondary">
									<Checkbox
										checked={person.is_owner || selected.has(person.id)}
										disabled={person.is_owner}
										onCheckedChange={(on) => toggle(person.id, on)}
									/>
									<span className="truncate">
										{person.display_name ?? person.nick}
									</span>
									{person.is_owner && (
										<span className="ml-auto text-xs text-muted-foreground">
											Dono
										</span>
									)}
								</label>
							</li>
						))}
						{shown.length === 0 && (
							<li className="px-3 py-2 text-[13px] text-muted-foreground">
								Ninguém com esse nome.
							</li>
						)}
					</ul>
				</div>
			)}
		</section>
	);
}

/** O que o pedido de criar e de editar leva da restrição. */
export function accessRequest(value: AccessValue): {
	restricted: boolean;
	member_ids?: string[];
} {
	return value.restricted
		? { restricted: true, member_ids: value.memberIds }
		: { restricted: false };
}

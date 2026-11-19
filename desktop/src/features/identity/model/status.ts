/**
 * O status (ADR 0022): o que cada um quer dizer, como no quadro "Status — menu no seu painel".
 *
 * `Status` é o de verdade, que só a própria pessoa vê. `Shown` é o que os outros veem de quem está
 * online: o Invisível sai da API como offline, então nunca chega aqui como status de outra pessoa.
 */
import type { Status } from "@/lib/api";

export interface StatusOption {
	value: Status;
	label: string;
	description: string;
}

export const STATUS_OPTIONS: readonly StatusOption[] = [
	{ value: "available", label: "Disponível", description: "Tudo normal." },
	{
		value: "busy",
		label: "Ocupado",
		description: "Sem notificações nem toque de ligação. Quem liga cai no chat.",
	},
	{
		value: "invisible",
		label: "Invisível",
		description: "Você aparece offline, mas usa tudo normalmente.",
	},
];

export function statusLabel(status: Status): string {
	return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "";
}

/** Um valor que veio do disco e pode não ser um status. */
export function isStatus(value: unknown): value is Status {
	return STATUS_OPTIONS.some((option) => option.value === value);
}

/**
 * Os atalhos globais (ADR 0029, decisões 6 a 8): quais existem, os padrões e as combinações. A
 * combinação tem o formato que o Rust usa (`shortcuts/combo.rs`): a tecla pelo código virtual do
 * Windows (`VK_*`) ou um botão do mouse, e os modificadores.
 */

export type ShortcutId = "mute" | "deafen" | "ptt" | "answer" | "decline";

export type MouseButton = "middle" | "x1" | "x2";

export interface Combo {
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	win: boolean;
	key: number | null;
	mouse: MouseButton | null;
}

/** Um atalho definido: a combinação e o nome dela, como o Windows deu ao gravar ("Ctrl+Shift+M"). */
export interface Shortcut {
	combo: Combo;
	label: string;
}

export type Shortcuts = Record<ShortcutId, Shortcut | null>;

export const SHORTCUT_IDS: readonly ShortcutId[] = [
	"mute",
	"deafen",
	"ptt",
	"answer",
	"decline",
];

export const SHORTCUT_NAMES: Record<ShortcutId, string> = {
	mute: "Desativar microfone",
	deafen: "Desativar áudio",
	ptt: "Pressionar para falar",
	answer: "Atender ligação",
	decline: "Recusar ou desligar",
};

/** `Ctrl+Shift+` e a letra. */
function ctrlShift(letter: string): Shortcut {
	return {
		combo: {
			ctrl: true,
			shift: true,
			alt: false,
			win: false,
			key: letter.charCodeAt(0),
			mouse: null,
		},
		label: `Ctrl+Shift+${letter}`,
	};
}

export const DEFAULT_SHORTCUTS: Shortcuts = {
	mute: ctrlShift("M"),
	deafen: ctrlShift("D"),
	ptt: null,
	answer: ctrlShift("A"),
	decline: ctrlShift("E"),
};

export function sameCombo(a: Combo, b: Combo): boolean {
	return (
		a.ctrl === b.ctrl &&
		a.shift === b.shift &&
		a.alt === b.alt &&
		a.win === b.win &&
		a.key === b.key &&
		a.mouse === b.mouse
	);
}

/** A tecla Esc sozinha: na gravação, desiste. */
export function isEscape(combo: Combo): boolean {
	return (
		combo.key === 0x1b &&
		!combo.ctrl &&
		!combo.shift &&
		!combo.alt &&
		!combo.win
	);
}

/** Quem já usa `combo`, fora `except`. */
export function usedBy(
	shortcuts: Shortcuts,
	combo: Combo,
	except: ShortcutId,
): ShortcutId | null {
	for (const id of SHORTCUT_IDS) {
		const shortcut = shortcuts[id];
		if (id !== except && shortcut && sameCombo(shortcut.combo, combo)) {
			return id;
		}
	}
	return null;
}

/** As teclas do nome, uma por caixinha: "Ctrl+Shift+M" vira Ctrl, Shift e M. Um "+" sozinho fica. */
export function labelKeys(label: string): string[] {
	return label.split(/\+(?=.)/).filter((part) => part !== "");
}

const MOUSE: readonly MouseButton[] = ["middle", "x1", "x2"];

function readCombo(value: unknown): Combo | null {
	if (typeof value !== "object" || value === null) return null;
	const v = value as Record<string, unknown>;
	const flag = (key: string) => v[key] === true;
	const key =
		typeof v.key === "number" &&
		Number.isInteger(v.key) &&
		v.key > 0 &&
		v.key < 256
			? v.key
			: null;
	const mouse = MOUSE.includes(v.mouse as MouseButton)
		? (v.mouse as MouseButton)
		: null;
	if ((key === null) === (mouse === null)) return null;
	return {
		ctrl: flag("ctrl"),
		shift: flag("shift"),
		alt: flag("alt"),
		win: flag("win"),
		key,
		mouse,
	};
}

/** Lê do disco: um atalho estranho vira "sem atalho"; um que nunca foi mexido, o padrão. */
export function readShortcuts(saved: unknown): Shortcuts {
	const value = (
		typeof saved === "object" && saved !== null ? saved : {}
	) as Record<string, unknown>;
	const shortcuts = { ...DEFAULT_SHORTCUTS };
	for (const id of SHORTCUT_IDS) {
		if (!(id in value)) continue;
		const entry = value[id] as { combo?: unknown; label?: unknown } | null;
		const combo = entry ? readCombo(entry.combo) : null;
		shortcuts[id] =
			combo && typeof entry?.label === "string" && entry.label !== ""
				? { combo, label: entry.label }
				: null;
	}
	return shortcuts;
}

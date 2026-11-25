import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUNDBOARD, setSounds, useSoundboard } from "@/features/sounds";
import type { Sound } from "@/lib/api";
import { filterSounds, SoundGrid } from "../components/SoundGrid";
import { slotSound } from "../model/play";

const sound = (id: string, name: string, emoji: string | null = null): Sound => ({
	id,
	name,
	emoji,
	file_id: `arq-${id}`,
	duration_ms: 800,
	uploaded_by: "kid",
	uploader_name: "Kid",
	status: "approved",
	reason: null,
	created_at: 0,
	reviewed_at: 0,
});

const SOUNDS = [
	sound("buzina", "Buzina", "📯"),
	sound("ae", "Aê Galera"),
	sound("tambor", "Tambor"),
];

beforeEach(() => {
	setSounds(SOUNDS);
	useSoundboard.setState({ ...DEFAULT_SOUNDBOARD, slots: ["tambor", "sumiu", null, null] });
});

describe("a grade de sons", () => {
	it("a busca ignora acento e caixa, e acha pelo emoji", () => {
		expect(filterSounds(SOUNDS, "ae").map((s) => s.id)).toEqual(["ae"]);
		expect(filterSounds(SOUNDS, "📯").map((s) => s.id)).toEqual(["buzina"]);
		expect(filterSounds(SOUNDS, " ")).toHaveLength(3);
	});

	it("mostra os lugares, o som removido e o número dourado", () => {
		render(<SoundGrid onPlay={vi.fn()} />);
		expect(screen.getByRole("button", { name: "Lugar 1: Tambor" })).toBeInTheDocument();
		expect(screen.getByRole("group", { name: "Lugar 2: som removido" })).toHaveTextContent(
			"Som removido",
		);
		expect(screen.getByRole("group", { name: "Lugar 3: vazio" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Tambor, lugar 1" })).toBeInTheDocument();
	});

	it("clicar toca, e a busca filtra", async () => {
		const onPlay = vi.fn();
		const user = userEvent.setup();
		render(<SoundGrid onPlay={onPlay} />);
		await user.click(screen.getByRole("button", { name: "Buzina" }));
		expect(onPlay).toHaveBeenCalledWith(SOUNDS[0]);
		await user.type(screen.getByRole("textbox", { name: "Buscar som" }), "xyz");
		expect(screen.getByText("Nenhum som com esse nome.")).toBeInTheDocument();
	});

	it("esvaziar o lugar do som removido", async () => {
		const user = userEvent.setup();
		render(<SoundGrid onPlay={vi.fn()} />);
		await user.click(screen.getByRole("button", { name: "Esvaziar o lugar 2" }));
		expect(useSoundboard.getState().slots).toEqual(["tambor", null, null, null]);
	});

	it("o atalho só acha o som do lugar que ainda existe", () => {
		expect(slotSound(0)?.id).toBe("tambor");
		expect(slotSound(1)).toBeNull();
		expect(slotSound(2)).toBeNull();
	});

	it("sem sons no grupo, explica onde enviar", () => {
		setSounds([]);
		render(<SoundGrid onPlay={vi.fn()} />);
		expect(screen.getByText(/Nenhum som no grupo ainda/)).toBeInTheDocument();
	});
});

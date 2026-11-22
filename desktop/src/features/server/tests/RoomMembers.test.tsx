import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ChannelMember,
	focusShare,
	useVoice,
	watchShare,
} from "@/features/voice";
import { RoomMembers } from "../components/RoomMembers";

const join = vi.fn();
vi.mock("@/features/voice", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/features/voice")>()),
	useVoice: vi.fn(),
	useGuardedJoin: () => ({
		guard: (_name: string, go: () => void) => go(),
		dialog: null,
	}),
	watchShare: vi.fn(),
	focusShare: vi.fn(),
}));

beforeEach(() => {
	join.mockReset();
	vi.mocked(watchShare).mockReset();
	vi.mocked(focusShare).mockReset();
	vi.mocked(useVoice).mockReturnValue({ join } as unknown as ReturnType<
		typeof useVoice
	>);
});

function renderRoom(inCall: boolean) {
	render(
		<MemoryRouter>
			<RoomMembers
				members={members}
				myId="kid"
				roomId="sala"
				roomName="Sala"
				inCall={inCall}
			/>
		</MemoryRouter>,
	);
}

const members: ChannelMember[] = [
	{ id: "kid", nick: "kid", name: "Kid", sharing: false },
	{ id: "juju", nick: "juju", name: "Júlia", sharing: true },
];

async function openCard(name: string, inCall: boolean) {
	const user = userEvent.setup();
	renderRoom(inCall);
	await user.click(screen.getByRole("button", { name: new RegExp(name) }));
	return screen.findByRole("dialog", { name: `Perfil de ${name}` });
}

describe("o cartão de quem está na sala", () => {
	it("na mesma sala que você, o cartão dos outros tem o volume", async () => {
		const card = await openCard("Júlia", true);

		expect(within(card).getByText("Em Sala · transmitindo")).toBeVisible();
		expect(
			within(card).getByRole("slider", { name: "Volume de Júlia" }),
		).toBeVisible();
	});

	it("o seu próprio cartão não tem ações", async () => {
		const card = await openCard("Kid", true);

		expect(within(card).getByText("Em Sala")).toBeVisible();
		expect(within(card).queryByRole("slider")).toBeNull();
	});

	it("de fora da sala, o cartão não tem o volume: você não está ouvindo a pessoa", async () => {
		const card = await openCard("Júlia", false);

		expect(within(card).queryByRole("slider")).toBeNull();
	});

	it("passar o mouse em quem transmite abre Assistir, que entra na sala e abre a transmissão", async () => {
		const user = userEvent.setup();
		renderRoom(false);
		await user.hover(screen.getByRole("button", { name: /Júlia/ }));
		const card = await screen.findByLabelText("Transmissão de Júlia");
		await user.click(within(card).getByRole("button", { name: "Assistir" }));

		expect(join).toHaveBeenCalledWith("sala");
		expect(watchShare).toHaveBeenCalledWith("juju");
		expect(focusShare).toHaveBeenCalledWith("juju");
	});

	it("já na sala, é só Assistir, sem entrar de novo", async () => {
		const user = userEvent.setup();
		renderRoom(true);
		await user.hover(screen.getByRole("button", { name: /Júlia/ }));
		const card = await screen.findByLabelText("Transmissão de Júlia");
		await user.click(within(card).getByRole("button", { name: "Assistir" }));

		expect(join).not.toHaveBeenCalled();
		expect(watchShare).toHaveBeenCalledWith("juju");
	});

	it("clicar abre o cartão da pessoa e fecha o de assistir", async () => {
		const user = userEvent.setup();
		renderRoom(false);
		const row = screen.getByRole("button", { name: /Júlia/ });
		await user.hover(row);
		await screen.findByLabelText("Transmissão de Júlia");
		await user.click(row);

		await screen.findByRole("dialog", { name: "Perfil de Júlia" });
		await vi.waitFor(() =>
			expect(screen.queryByLabelText("Transmissão de Júlia")).toBeNull(),
		);
	});

	it("quem não transmite não tem o cartão de assistir", async () => {
		const user = userEvent.setup();
		renderRoom(false);
		await user.hover(screen.getByRole("button", { name: /Kid/ }));
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(screen.queryByLabelText(/Transmissão de/)).toBeNull();
	});
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChannelMember } from "@/features/voice";
import { RoomMembers } from "../components/RoomMembers";

const members: ChannelMember[] = [
	{ id: "kid", nick: "kid", name: "Kid", sharing: false },
	{ id: "juju", nick: "juju", name: "Júlia", sharing: true },
];

async function openCard(name: string, inCall: boolean) {
	const user = userEvent.setup();
	render(
		<RoomMembers
			members={members}
			myId="kid"
			roomId="sala"
			roomName="Sala"
			inCall={inCall}
		/>,
	);
	await user.click(screen.getByRole("button", { name: new RegExp(name) }));
	return screen.findByRole("dialog", { name: `Perfil de ${name}` });
}

describe("o cartão de quem está na sala", () => {
	it("na mesma sala que você, o cartão dos outros tem o volume", async () => {
		const card = await openCard("Júlia", true);

		expect(within(card).getByText("Na Sala · transmitindo")).toBeVisible();
		expect(
			within(card).getByRole("slider", { name: "Volume de Júlia" }),
		).toBeVisible();
	});

	it("o seu próprio cartão não tem ações", async () => {
		const card = await openCard("Kid", true);

		expect(within(card).getByText("Na Sala")).toBeVisible();
		expect(within(card).queryByRole("slider")).toBeNull();
	});

	it("de fora da sala, o cartão não tem o volume: você não está ouvindo a pessoa", async () => {
		const card = await openCard("Júlia", false);

		expect(within(card).queryByRole("slider")).toBeNull();
	});
});

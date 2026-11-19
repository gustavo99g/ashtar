import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ParticipantTile } from "../components/ParticipantTile";
import { UserVolume, UserVolumeMark } from "../components/UserVolume";
import type { ChannelMember } from "../model/members";
import {
	heardVolume,
	setUserVolume,
	toggleUserMuted,
	useUserVolumes,
} from "../stores/userVolumeStore";

const juju: ChannelMember = {
	id: "juju",
	nick: "juju",
	name: "Júlia",
	sharing: false,
};

const heard = () => heardVolume(useUserVolumes.getState(), "juju");

beforeEach(() => {
	localStorage.clear();
	useUserVolumes.setState({ volumes: {} });
});

describe("o controle de volume de uma pessoa", () => {
	it("mostra o volume de agora e anda pelo teclado", async () => {
		const user = userEvent.setup();
		setUserVolume("juju", 80);
		render(<UserVolume userId="juju" name="Júlia" />);
		const section = screen.getByRole("region", { name: "Volume de Júlia" });
		expect(within(section).getByText("80%")).toBeVisible();

		const slider = within(section).getByRole("slider", {
			name: "Volume de Júlia",
		});
		expect(slider).toHaveAttribute("max", "200");
		slider.focus();
		await user.keyboard("{ArrowRight}");

		expect(heard()).toBe(81);
		expect(within(section).getByText("81%")).toBeVisible();
	});

	it("o alto-falante silencia só para você e, de novo, volta ao volume de antes", async () => {
		const user = userEvent.setup();
		setUserVolume("juju", 140);
		render(<UserVolume userId="juju" name="Júlia" />);
		const speaker = screen.getByRole("button", {
			name: "Silenciar Júlia só para você",
		});
		expect(speaker).toHaveAttribute("aria-pressed", "false");

		await user.click(speaker);
		expect(heard()).toBe(0);
		expect(speaker).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByText("0%")).toBeVisible();

		await user.click(speaker);
		expect(heard()).toBe(140);
	});
});

describe("a marca no bloco", () => {
	it("em 100% não aparece; fora disso mostra a porcentagem ou o silenciado", () => {
		const { rerender } = render(<UserVolumeMark userId="juju" />);
		expect(screen.queryByLabelText(/para você/)).toBeNull();

		setUserVolume("juju", 140);
		rerender(<UserVolumeMark userId="juju" />);
		expect(screen.getByLabelText("volume em 140% para você")).toHaveTextContent(
			"140%",
		);

		toggleUserMuted("juju");
		rerender(<UserVolumeMark userId="juju" />);
		expect(screen.getByLabelText("silenciado só para você")).toBeVisible();
	});
});

describe("o bloco da pessoa na grade", () => {
	it("clicar no bloco de outra pessoa abre só o volume dela", async () => {
		const user = userEvent.setup();
		render(<ParticipantTile member={juju} isLocal={false} />);

		await user.click(screen.getByRole("button", { name: "Volume de Júlia" }));

		const popup = await screen.findByRole("dialog", { name: "Volume de Júlia" });
		expect(
			within(popup).getByRole("slider", { name: "Volume de Júlia" }),
		).toBeVisible();
	});

	it("o próprio bloco não abre nada e não tem marca", () => {
		setUserVolume("juju", 50);
		render(<ParticipantTile member={juju} isLocal />);

		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByLabelText(/para você/)).toBeNull();
	});

	it("na faixa do Foco o bloco não abre o volume, mas mostra a marca", () => {
		setUserVolume("juju", 50);
		render(<ParticipantTile member={juju} isLocal={false} size="strip" />);

		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByLabelText("volume em 50% para você")).toBeVisible();
	});
});

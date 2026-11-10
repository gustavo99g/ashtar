import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	UserCard,
	type UserCardPerson,
	whereLabel,
} from "../components/UserCard";

const juju: UserCardPerson = {
	nick: "juju",
	name: "Júlia",
	online: true,
	room: null,
};

describe("o cartão do usuário", () => {
	it("diz onde a pessoa está: na sala, transmitindo, online ou offline", () => {
		expect(whereLabel({ online: true, room: null })).toBe("Online");
		expect(whereLabel({ online: false, room: null })).toBe("Offline");
		expect(
			whereLabel({ online: true, room: { name: "Sala", sharing: false } }),
		).toBe("Na Sala");
		expect(
			whereLabel({ online: true, room: { name: "Sala", sharing: true } }),
		).toBe("Na Sala · transmitindo");
	});

	it("mostra o nome visível, o nick e onde ela está", () => {
		render(
			<UserCard
				person={{ ...juju, room: { name: "Sala", sharing: true } }}
			/>,
		);

		expect(screen.getByText("Júlia")).toBeVisible();
		expect(screen.getByText("juju")).toBeVisible();
		expect(screen.getByText("Na Sala · transmitindo")).toBeVisible();
	});

	it("as seções entram embaixo do cabeçalho, na ordem em que vêm", () => {
		render(
			<UserCard person={juju}>
				<section aria-label="Volume de Júlia" />
				<section aria-label="Ações" />
			</UserCard>,
		);

		expect(
			screen.getAllByRole("region").map((s) => s.getAttribute("aria-label")),
		).toEqual(["Volume de Júlia", "Ações"]);
		// E o cabeçalho continua o mesmo.
		expect(screen.getByText("Online")).toBeVisible();
	});
});

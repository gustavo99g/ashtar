import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationLayout, notificationOpen } from "@/lib/tauri/commands";
import { type CardInput, cardKey } from "../model/cards";
import { NotificationStack, receiveCard } from "../components/NotificationStack";
import { resetSoundGap } from "../model/sound";
import { clearStack } from "../stores/stackStore";

vi.mock("@/lib/tauri/commands", () => ({
	notificationLayout: vi.fn(() => Promise.resolve()),
	notificationOpen: vi.fn(() => Promise.resolve()),
	onNotificationCard: vi.fn(() => Promise.resolve(() => {})),
}));

// O jsdom não tem `ResizeObserver`; a altura em si é coisa da janela de verdade.
vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		disconnect() {}
	},
);

function card(name: string, body = "oi"): CardInput {
	const target = { kind: "dm", channelId: `d-${name}` } as const;
	return {
		key: cardKey(target),
		kind: "dm",
		person: { nick: name, displayName: null },
		title: name,
		context: "Mensagem privada",
		body,
		sound: null,
		target,
	};
}

const cards = () => screen.queryAllByRole("button", { name: /Mensagem privada/ });

describe("a janela dos avisos", () => {
	beforeEach(() => {
		clearStack();
		resetSoundGap();
		vi.mocked(notificationOpen).mockClear();
		vi.mocked(notificationLayout).mockClear();
	});

	it("mostra no máximo três cartões, e o quarto tira o mais antigo", () => {
		render(<NotificationStack />);
		act(() => {
			for (const name of ["ana", "bia", "caio", "duda"]) receiveCard(card(name));
		});
		expect(cards().map((c) => c.getAttribute("aria-label")?.split(",")[0])).toEqual([
			"duda",
			"caio",
			"bia",
		]);
	});

	it("a mesma conversa atualiza o cartão e mostra quantas chegaram", () => {
		render(<NotificationStack />);
		act(() => {
			receiveCard(card("ana", "primeira"));
			receiveCard(card("ana", "segunda"));
		});
		expect(cards()).toHaveLength(1);
		expect(screen.getByText("segunda")).toBeInTheDocument();
		expect(screen.getByText("2 novas")).toBeInTheDocument();
	});

	it("clicar abre o alvo na janela principal e tira o cartão", async () => {
		render(<NotificationStack />);
		act(() => receiveCard(card("ana")));
		await userEvent.click(cards()[0]);
		expect(notificationOpen).toHaveBeenCalledWith({ kind: "dm", channelId: "d-ana" });
		expect(cards()).toHaveLength(0);
	});

	it("o X só fecha", async () => {
		render(<NotificationStack />);
		act(() => {
			receiveCard(card("ana"));
			receiveCard(card("bia"));
		});
		const region = screen.getByRole("region", { name: "Avisos" });
		await userEvent.click(within(region).getAllByRole("button", { name: "Fechar aviso" })[0]);
		expect(notificationOpen).not.toHaveBeenCalled();
		expect(cards()).toHaveLength(1);
	});

	it("o cartão some quando a barra de tempo termina", () => {
		render(<NotificationStack />);
		act(() => receiveCard(card("ana")));
		const timer = document.querySelector('[data-slot="notification-timer"]');
		act(() => {
			timer?.dispatchEvent(new Event("animationend", { bubbles: true }));
		});
		expect(cards()).toHaveLength(0);
	});

	it("sem cartões, pede para esconder a janela", () => {
		render(<NotificationStack />);
		expect(notificationLayout).toHaveBeenLastCalledWith(0);
	});

	it("ignora o que não é um cartão", () => {
		render(<NotificationStack />);
		act(() => receiveCard({ qualquer: "coisa" }));
		expect(cards()).toHaveLength(0);
	});
});

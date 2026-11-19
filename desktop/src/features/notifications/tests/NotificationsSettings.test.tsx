import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATIONS, useSettingsStore } from "@/features/settings";
import type { Status } from "@/lib/api";
import { notificationShow } from "@/lib/tauri/commands";
import { NotificationsSettings } from "../components/NotificationsSettings";

vi.mock("@/lib/tauri/commands", () => ({
	notificationShow: vi.fn(() => Promise.resolve(true)),
}));

let status: Status = "available";
vi.mock("@/features/identity", async (original) => ({
	...(await original<typeof import("@/features/identity")>()),
	useMyStatus: () => status,
	useMe: () => ({
		data: { user: { id: "u1", nick: "kid", display_name: "Kid", is_owner: true } },
	}),
}));

describe("Configurações › Notificações", () => {
	beforeEach(() => {
		status = "available";
		useSettingsStore.setState({ notifications: DEFAULT_NOTIFICATIONS });
		vi.mocked(notificationShow).mockClear();
	});

	it("cada chave muda a preferência deste computador", async () => {
		render(<NotificationsSettings />);
		const dms = screen.getByRole("switch", { name: "Mensagens privadas" });
		expect(dms).toBeChecked();
		await userEvent.click(dms);
		expect(useSettingsStore.getState().notifications.dms).toBe(false);
		await userEvent.click(screen.getByRole("switch", { name: "Sons" }));
		expect(useSettingsStore.getState().notifications).toEqual({
			...DEFAULT_NOTIFICATIONS,
			dms: false,
			sounds: false,
		});
	});

	it("o teste mostra um cartão com o seu nome, com som se ele estiver ligado", async () => {
		render(<NotificationsSettings />);
		await userEvent.click(screen.getByRole("button", { name: "Testar" }));
		expect(notificationShow).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Kid", sound: "dm", target: { kind: "app" } }),
		);
	});

	it("diz quando o Windows segurou o aviso", async () => {
		vi.mocked(notificationShow).mockResolvedValueOnce(false);
		render(<NotificationsSettings />);
		await userEvent.click(screen.getByRole("button", { name: "Testar" }));
		expect(await screen.findByRole("status")).toHaveTextContent(/pediu silêncio/);
	});

	it("em Ocupado, lembra que nada aparece", () => {
		status = "busy";
		render(<NotificationsSettings />);
		expect(screen.getByRole("status")).toHaveTextContent(/nenhum aviso aparece/);
	});
});

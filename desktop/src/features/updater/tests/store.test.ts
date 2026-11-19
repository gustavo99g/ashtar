import { beforeEach, describe, expect, it, vi } from "vitest";
import { installUpdate, whatsNew } from "@/lib/tauri/commands";
import {
	closeWhatsNew,
	confirmRestart,
	hideUpdateNotice,
	openWhatsNew,
	restartToUpdate,
	showWhatsNewOnce,
	updateFailed,
	updateReady,
	useUpdaterStore,
} from "../stores/updaterStore";

vi.mock("@/lib/tauri/commands", () => ({
	installUpdate: vi.fn(),
	whatsNew: vi.fn(),
}));

const NOTES = {
	version: "0.2.21",
	sections: [{ version: "0.2.21", notes: "- Configurações novas." }],
};

beforeEach(() => {
	useUpdaterStore.setState({
		readyVersion: null,
		notice: null,
		whatsNew: null,
		whatsNewOpen: false,
		lastSeenVersion: null,
	});
	localStorage.clear();
	vi.mocked(installUpdate).mockReset();
	vi.mocked(whatsNew).mockReset();
});

describe("o aviso de atualização", () => {
	it("a versão baixada mostra o aviso e fica guardada depois do Depois", () => {
		updateReady("0.2.21");
		expect(useUpdaterStore.getState()).toMatchObject({
			readyVersion: "0.2.21",
			notice: { kind: "ready" },
		});

		hideUpdateNotice();
		expect(useUpdaterStore.getState()).toMatchObject({
			readyVersion: "0.2.21",
			notice: null,
		});
	});

	it("numa chamada, o Reiniciar pergunta antes e só instala na confirmação", () => {
		vi.mocked(installUpdate).mockReturnValue(new Promise(() => {}));
		updateReady("0.2.21");

		restartToUpdate(true);
		expect(useUpdaterStore.getState().notice).toEqual({ kind: "confirm" });
		expect(installUpdate).not.toHaveBeenCalled();

		confirmRestart();
		expect(useUpdaterStore.getState().notice).toEqual({ kind: "restarting" });
		expect(installUpdate).toHaveBeenCalledTimes(1);
	});

	it("fora da chamada, instala na hora, e um evento novo não apaga o Reiniciando", () => {
		vi.mocked(installUpdate).mockReturnValue(new Promise(() => {}));
		restartToUpdate(false);
		expect(installUpdate).toHaveBeenCalledTimes(1);

		updateReady("0.2.22");
		expect(useUpdaterStore.getState()).toMatchObject({
			readyVersion: "0.2.22",
			notice: { kind: "restarting" },
		});
	});

	it("se a instalação falha, mostra o Não deu para atualizar", async () => {
		vi.mocked(installUpdate).mockRejectedValue({
			kind: "Update",
			message: "x",
		});
		restartToUpdate(false);
		await vi.waitFor(() =>
			expect(useUpdaterStore.getState().notice).toEqual({
				kind: "failed",
				message: "Tentamos de novo mais tarde.",
			}),
		);
	});

	it("a falha que vem do Rust traz o texto dele", () => {
		updateFailed(
			"A assinatura do arquivo não confere. Tentamos de novo mais tarde.",
		);
		expect(useUpdaterStore.getState().notice).toEqual({
			kind: "failed",
			message:
				"A assinatura do arquivo não confere. Tentamos de novo mais tarde.",
		});
	});
});

describe("o que há de novo", () => {
	it("aparece uma vez por versão", async () => {
		vi.mocked(whatsNew).mockResolvedValue(NOTES);

		await showWhatsNewOnce();
		expect(useUpdaterStore.getState()).toMatchObject({
			whatsNew: NOTES,
			whatsNewOpen: true,
		});

		closeWhatsNew();
		expect(useUpdaterStore.getState().whatsNewOpen).toBe(false);
		expect(useUpdaterStore.getState().lastSeenVersion).toBe("0.2.21");
		expect(localStorage.getItem("ashtar-updater")).toContain("0.2.21");

		await showWhatsNewOnce();
		expect(useUpdaterStore.getState().whatsNewOpen).toBe(false);
	});

	it("o link da tela Aplicativo abre mesmo depois de visto", async () => {
		useUpdaterStore.setState({ lastSeenVersion: "0.2.21" });
		vi.mocked(whatsNew).mockResolvedValue(NOTES);

		await openWhatsNew();
		expect(useUpdaterStore.getState().whatsNewOpen).toBe(true);
		// O link mostra só a versão instalada.
		expect(whatsNew).toHaveBeenLastCalledWith(null);
	});

	it("quem já viu antes do persist não vê de novo", async () => {
		localStorage.setItem("ashtar.lastSeenVersion", "0.2.21");
		await useUpdaterStore.persist.rehydrate();
		vi.mocked(whatsNew).mockResolvedValue(NOTES);

		await showWhatsNewOnce();

		expect(useUpdaterStore.getState().whatsNewOpen).toBe(false);
	});

	it("sem seção no CHANGELOG.md, não abre", async () => {
		vi.mocked(whatsNew).mockResolvedValue(null);
		await showWhatsNewOnce();
		await openWhatsNew();
		expect(useUpdaterStore.getState().whatsNewOpen).toBe(false);
	});
});

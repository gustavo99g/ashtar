import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkForUpdate,
	installUpdate,
	onUpdateFailed,
	onUpdateReady,
	pendingUpdate,
} from "@/lib/tauri/commands";
import {
	UPDATE_NOT_FOUND,
	UPDATE_WAIT_MS,
	useUpdateNow,
} from "../useUpdateNow";

vi.mock("@/lib/tauri/commands", () => ({
	checkForUpdate: vi.fn(),
	installUpdate: vi.fn(),
	isAppError: (value: unknown) =>
		typeof value === "object" && value !== null && "message" in value,
	onUpdateFailed: vi.fn(),
	onUpdateReady: vi.fn(),
	pendingUpdate: vi.fn(),
}));

// Os eventos do Rust: o teste dispara com `ready` e `failed`.
let ready: (event: { version: string }) => void;
let failed: (event: { message: string }) => void;
const unlisten = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(onUpdateReady).mockImplementation(async (callback) => {
		ready = callback;
		return unlisten;
	});
	vi.mocked(onUpdateFailed).mockImplementation(async (callback) => {
		failed = callback;
		return unlisten;
	});
	vi.mocked(pendingUpdate).mockResolvedValue(null);
	vi.mocked(checkForUpdate).mockResolvedValue();
	// Instalar dá certo: o app fecharia, a promessa nunca resolve.
	vi.mocked(installUpdate).mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

/** Começa o "Atualizar agora" e deixa as promessas andarem. */
async function startUpdate() {
	const hook = renderHook(() => useUpdateNow());
	await act(async () => hook.result.current.start());
	return hook;
}

describe("useUpdateNow", () => {
	it("verifica, espera o download e instala", async () => {
		const { result } = await startUpdate();
		expect(checkForUpdate).toHaveBeenCalled();
		expect(result.current.state).toEqual({ status: "checking" });

		await act(async () => ready({ version: "0.2.20" }));

		expect(result.current.state).toEqual({ status: "installing" });
		expect(installUpdate).toHaveBeenCalledTimes(1);
		expect(unlisten).toHaveBeenCalledTimes(2);
	});

	it("com a versão já baixada, instala sem verificar", async () => {
		vi.mocked(pendingUpdate).mockResolvedValue("0.2.20");

		const { result } = await startUpdate();

		expect(result.current.state).toEqual({ status: "installing" });
		expect(checkForUpdate).not.toHaveBeenCalled();
	});

	it("mostra a falha do download ou da assinatura", async () => {
		const { result } = await startUpdate();

		act(() => failed({ message: "A assinatura não confere." }));

		expect(result.current.state).toEqual({
			status: "failed",
			message: "A assinatura não confere.",
		});
		expect(installUpdate).not.toHaveBeenCalled();
	});

	it("sem notícia do Rust, desiste depois de um tempo", async () => {
		const { result } = await startUpdate();

		act(() => vi.advanceTimersByTime(UPDATE_WAIT_MS));

		expect(result.current.state).toEqual({
			status: "failed",
			message: UPDATE_NOT_FOUND,
		});
		// O aviso que chega depois não instala nada.
		act(() => ready({ version: "0.2.20" }));
		expect(installUpdate).not.toHaveBeenCalled();
	});

	it("a falha ao instalar volta para a tela", async () => {
		vi.mocked(installUpdate).mockRejectedValue({
			kind: "Update",
			message: "Falhou ao instalar.",
		});
		const { result } = await startUpdate();

		await act(async () => ready({ version: "0.2.20" }));

		expect(result.current.state).toEqual({
			status: "failed",
			message: "Falhou ao instalar.",
		});
	});
});

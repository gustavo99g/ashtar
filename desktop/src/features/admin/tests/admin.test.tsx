import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import {
	ApiError,
	type AuditEntry,
	getServerStatus,
	listAudit,
	type LogReportView,
	listLogEntries,
	listLogReports,
	readLogEntry,
	type ServerStatus,
	sendLogs,
} from "@/lib/api";
import { downloadFile, logsBundle } from "@/lib/tauri/commands";
import { AuditSettings } from "../components/AuditSettings";
import { LogsSettings } from "../components/LogsSettings";
import { SendLogs } from "../components/SendLogs";
import { ServerStatusSettings } from "../components/ServerStatusSettings";
import { auditPhrase, auditPlace, auditWhen } from "../model/audit";
import { ago, duration, size } from "../model/format";
import { handleAdminRealtime, onLogsReceived } from "../realtime";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	sendLogs: vi.fn(),
	listLogReports: vi.fn(),
	getServerStatus: vi.fn(),
	listAudit: vi.fn(),
	listLogEntries: vi.fn(),
	readLogEntry: vi.fn(),
}));
vi.mock("@/lib/tauri/commands", () => ({
	logsBundle: vi.fn(),
	downloadFile: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { add: vi.fn(() => "aviso"), close: vi.fn() },
}));

const report: LogReportView = {
	id: "r1",
	user_id: "u2",
	nick: "ana",
	display_name: "Ana",
	created_at: 1_763_600_000,
	app_version: "0.6.0",
	note: "a voz caiu",
	size: 320_000,
};

function wrap(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<MemoryRouter>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("o Enviar logs", () => {
	it("junta os logs, manda com o texto e confirma", async () => {
		const zip = new ArrayBuffer(8);
		vi.mocked(logsBundle).mockResolvedValue(zip);
		vi.mocked(sendLogs).mockResolvedValue(report);
		wrap(<SendLogs />);

		await userEvent.click(screen.getByRole("button", { name: "Enviar logs" }));
		await userEvent.type(
			screen.getByRole("textbox", { name: /O que aconteceu/ }),
			"a voz caiu",
		);
		await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

		await waitFor(() =>
			expect(sendLogs).toHaveBeenCalledWith(zip, "a voz caiu"),
		);
		await waitFor(() =>
			expect(toast.add).toHaveBeenCalledWith(
				expect.objectContaining({ title: "Logs enviados" }),
			),
		);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("mandar de novo logo depois explica a espera", async () => {
		vi.mocked(logsBundle).mockResolvedValue(new ArrayBuffer(8));
		vi.mocked(sendLogs).mockRejectedValue(
			new ApiError({ status: 429, kind: "too_many_attempts", message: "x" }),
		);
		wrap(<SendLogs />);
		await userEvent.click(screen.getByRole("button", { name: "Enviar logs" }));
		await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Você mandou logs há pouco",
		);
	});
});

describe("o Painel", () => {
	it("lista os logs com quem mandou, a versão e o texto", async () => {
		vi.mocked(listLogReports).mockResolvedValue([report]);
		wrap(<LogsSettings />);
		expect(await screen.findByText("Ana")).toBeInTheDocument();
		expect(screen.getByText("a voz caiu")).toBeInTheDocument();
		expect(screen.getByText(/Ashtar 0\.6\.0/)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Baixar os logs de Ana" }),
		).toBeInTheDocument();
	});

	it("Ver abre os arquivos do .zip ali mesmo; Baixar salva pelo Rust", async () => {
		vi.mocked(listLogReports).mockResolvedValue([report]);
		vi.mocked(listLogEntries).mockResolvedValue([
			{ name: "info.txt", size: 12 },
			{ name: "logs/app.log", size: 15 },
		]);
		vi.mocked(readLogEntry).mockImplementation(async (_id, name) => ({
			name,
			text: name === "info.txt" ? "Ashtar 0.7.0" : "linha 1\nlinha 2",
			truncated: false,
		}));
		vi.mocked(downloadFile).mockResolvedValue("C:/Downloads/ana.zip");
		wrap(<LogsSettings />);

		await userEvent.click(
			await screen.findByRole("button", { name: "Ver os logs de Ana" }),
		);
		expect(await screen.findByText("Ashtar 0.7.0")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("tab", { name: /logs\/app\.log/ }));
		expect(await screen.findByText(/linha 2/)).toBeInTheDocument();
		expect(readLogEntry).toHaveBeenLastCalledWith("r1", "logs/app.log");

		await userEvent.click(
			screen.getByRole("button", { name: "Baixar os logs de Ana" }),
		);
		await waitFor(() =>
			expect(downloadFile).toHaveBeenCalledWith(
				"r1",
				"ashtar-logs-ana-1763600000.zip",
				undefined,
				"logs",
			),
		);
		expect(toast.add).toHaveBeenCalledWith({
			title: "Salvo em Downloads",
			description: "C:/Downloads/ana.zip",
			data: { tone: "success", compact: true },
			actionProps: { children: "Abrir pasta", onClick: expect.any(Function) },
		});
	});

	it("o estado do servidor mostra o LiveKit fora e o último backup", async () => {
		const status: ServerStatus = {
			api: { version: "0.6.0", uptime_secs: 3 * 86_400 + 4 * 3600 },
			livekit: { ok: false, latency_ms: null, error: "connection refused" },
			disk: { free_bytes: 20 * 1024 ** 3, total_bytes: 40 * 1024 ** 3 },
			last_backup: {
				name: "ashtar-2026-11-19-223000000.db",
				at: Math.floor(Date.now() / 1000) - 3600,
				size: 2048,
			},
			last_files_backup: { at: Math.floor(Date.now() / 1000) - 7200, files: 37 },
			files_bytes: 3 * 1024 ** 3,
		};
		vi.mocked(getServerStatus).mockResolvedValue(status);
		wrap(<ServerStatusSettings />);
		expect(await screen.findByText("Fora do ar")).toBeInTheDocument();
		expect(screen.getByText("connection refused")).toBeInTheDocument();
		expect(screen.getByText("No ar há 3 dias e 4 h")).toBeInTheDocument();
		expect(screen.getByText("20 GB livres")).toBeInTheDocument();
		expect(screen.getByText(/os arquivos ocupam 3 GB/)).toBeInTheDocument();
		expect(screen.getByText("há 1 h")).toBeInTheDocument();
		expect(screen.getByText("37 fotos, emojis e sons no R2")).toBeInTheDocument();
	});

	it("o logs.received atualiza a lista e avisa", () => {
		const client = new QueryClient();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const heard = vi.fn();
		const stop = onLogsReceived(heard);
		handleAdminRealtime({ type: "logs.received", report }, client);
		stop();
		expect(invalidate).toHaveBeenCalled();
		expect(heard).toHaveBeenCalledWith(report);
	});
});

describe("os textos", () => {
	it("tamanho, duração e há quanto tempo", () => {
		expect(size(312 * 1024)).toBe("312 KB");
		expect(size(4.2 * 1024 ** 2)).toBe("4,2 MB");
		expect(duration(8 * 60)).toBe("8 min");
		expect(duration(5 * 3600 + 12 * 60)).toBe("5 h e 12 min");
		expect(ago(100, 100 + 2 * 86_400)).toBe("há 2 dias");
	});
});

function auditEntry(id: number, patch: Partial<AuditEntry> = {}): AuditEntry {
	return {
		id,
		at: 1_763_850_000,
		kind: "voice",
		action: "voz.silenciar",
		actor: { id: "u1", name: "kid" },
		target: { id: "u2", name: "rafa" },
		place: "Jogatina",
		detail: null,
		...patch,
	};
}

describe("o registro", () => {
	beforeEach(() => vi.mocked(listAudit).mockReset());

	it("mostra a frase, quem fez e onde, e filtra por tipo", async () => {
		vi.mocked(listAudit).mockResolvedValue([
			auditEntry(2),
			auditEntry(1, {
				kind: "members",
				action: "permissoes.dar",
				detail: "Moderar voz",
				target: { id: "u3", name: "Lua" },
				place: null,
			}),
		]);
		wrap(<AuditSettings />);
		const rows = await screen.findAllByRole("listitem");
		expect(rows[0]).toHaveTextContent("silenciou o microfone de rafa");
		expect(rows[0]).toHaveTextContent("Jogatina");
		expect(rows[1]).toHaveTextContent("deu Moderar voz para Lua");
		expect(rows[1]).toHaveTextContent("Permissões");
		expect(listAudit).toHaveBeenLastCalledWith(null, undefined);

		await userEvent.click(screen.getByRole("radio", { name: "Voz" }));
		await waitFor(() =>
			expect(listAudit).toHaveBeenLastCalledWith("voice", undefined),
		);
	});

	it("carrega mais a partir da última linha", async () => {
		const page = Array.from({ length: 50 }, (_, i) => auditEntry(100 - i));
		vi.mocked(listAudit)
			.mockResolvedValueOnce(page)
			.mockResolvedValueOnce([auditEntry(10)]);
		wrap(<AuditSettings />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Carregar mais" }),
		);
		await waitFor(() =>
			expect(listAudit).toHaveBeenLastCalledWith(null, 51),
		);
		expect(await screen.findAllByRole("listitem")).toHaveLength(51);
		expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
	});

	it("os textos de cada ação e do quando", () => {
		const text = (entry: AuditEntry) =>
			auditPhrase(entry)
				.map((part) => part.text)
				.join("");
		expect(
			text(auditEntry(1, { action: "voz.mover", detail: "Squad" })),
		).toBe("moveu rafa para Squad");
		expect(
			text(
				auditEntry(1, {
					kind: "channels",
					action: "canais.criar",
					target: null,
					place: "Jogatina",
				}),
			),
		).toBe("criou Jogatina");
		expect(text(auditEntry(1, { action: "nova.acao" }))).toBe("nova.acao");
		expect(auditPlace(auditEntry(1, { kind: "invites", place: null }))).toBe(
			"Convites",
		);
		const now = new Date(2026, 10, 22, 23, 0).getTime();
		const at = (d: Date) => Math.floor(d.getTime() / 1000);
		expect(auditWhen(at(new Date(2026, 10, 22, 22, 20)), now)).toBe(
			"hoje, 22:20",
		);
		expect(auditWhen(at(new Date(2026, 10, 21, 23, 2)), now)).toBe(
			"ontem, 23:02",
		);
		expect(auditWhen(at(new Date(2026, 10, 18, 20, 11)), now)).toBe(
			"18 nov, 20:11",
		);
	});
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApiError,
	type FileView,
	type Message,
	sendMessage,
	uploadFile,
} from "@/lib/api";
import { useSendMessage } from "../queries";
import { useOutbox } from "../stores/outboxStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	sendMessage: vi.fn(),
	uploadFile: vi.fn(),
}));

function view(id: string, name: string): FileView {
	return {
		id,
		kind: "attachment",
		name,
		mime: "application/pdf",
		size: 3,
		width: null,
		height: null,
		duration_ms: null,
		thumbnail_id: null,
	};
}

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
	);
}

beforeEach(() => {
	useOutbox.setState({ pending: [] });
	vi.mocked(uploadFile).mockReset();
	vi.mocked(sendMessage).mockReset();
});

describe("mandar com anexos", () => {
	it("sobe os arquivos antes, com o progresso, e manda os ids; o Tentar de novo não sobe de novo", async () => {
		vi.mocked(uploadFile).mockImplementation(async (_file, options) => {
			options.onProgress?.(0.5);
			return view(`f-${options.name}`, options.name);
		});
		vi.mocked(sendMessage)
			.mockRejectedValueOnce(
				new ApiError({ status: 0, kind: "network", message: "Sem rede." }),
			)
			.mockImplementationOnce(
				async (_channel, request) =>
					({ id: "m1", client_id: request.client_id }) as unknown as Message,
			);
		const { result } = renderHook(() => useSendMessage(), { wrapper });
		const files = [
			{ key: "k1", file: new File(["abc"], "a.pdf") },
			{ key: "k2", file: new File(["abc"], "b.pdf") },
		];
		await act(async () => {
			result.current.send("geral", "", undefined, files);
		});
		await vi.waitFor(() =>
			expect(useOutbox.getState().pending[0]?.status).toBe("failed"),
		);
		expect(uploadFile).toHaveBeenCalledTimes(2);
		expect(sendMessage).toHaveBeenCalledWith("geral", {
			client_id: expect.any(String),
			body: "",
			attachments: ["f-a.pdf", "f-b.pdf"],
		});
		expect(useOutbox.getState().pending[0].files).toMatchObject([
			{ key: "k1", progress: 1, uploaded: "f-a.pdf" },
			{ key: "k2", progress: 1, uploaded: "f-b.pdf" },
		]);

		const clientId = useOutbox.getState().pending[0].client_id;
		await act(async () => {
			result.current.retry(clientId);
		});
		await vi.waitFor(() => expect(useOutbox.getState().pending).toEqual([]));
		expect(uploadFile).toHaveBeenCalledTimes(2);
		expect(vi.mocked(sendMessage).mock.calls[1][1].attachments).toEqual([
			"f-a.pdf",
			"f-b.pdf",
		]);
	});
});

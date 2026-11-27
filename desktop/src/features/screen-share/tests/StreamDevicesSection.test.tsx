import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createStreamPairCode,
	listStreamDevices,
	type StreamDevice,
	unlinkStreamDevice,
} from "@/lib/api";
import {
	remaining,
	StreamDevicesSection,
} from "../components/StreamDevicesSection";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listStreamDevices: vi.fn(),
	createStreamPairCode: vi.fn(),
	unlinkStreamDevice: vi.fn(),
}));

const odin: StreamDevice = {
	id: "abc",
	name: "Odin 3",
	paired_at: 1_764_000_000,
	last_seen_at: 1_764_000_000,
};

function renderSection() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<StreamDevicesSection />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.mocked(listStreamDevices).mockResolvedValue([]);
	vi.mocked(createStreamPairCode).mockResolvedValue({
		code: "ABCD-EFGH-JKMN",
		expires_at: Math.floor(Date.now() / 1000) + 600,
	});
	vi.mocked(unlinkStreamDevice).mockResolvedValue();
});

describe("aparelhos de transmissão", () => {
	it("o tempo que falta para o código vencer", () => {
		expect(remaining(1000, 1000 * 1000 - 600_000)).toBe("10:00");
		expect(remaining(1000, 1000 * 1000 - 61_000)).toBe("1:01");
		expect(remaining(1000, 2000 * 1000)).toBe("0:00");
	});

	it("gera o código para digitar no aparelho", async () => {
		renderSection();
		await userEvent.click(
			screen.getByRole("button", { name: "Parear um aparelho" }),
		);
		expect(await screen.findByText("ABCD-EFGH-JKMN")).toBeInTheDocument();
	});

	it("lista os pareados e desvincula", async () => {
		vi.mocked(listStreamDevices).mockResolvedValue([odin]);
		renderSection();
		expect(await screen.findByText("Odin 3")).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Desvincular Odin 3" }),
		);
		expect(unlinkStreamDevice).toHaveBeenCalledWith("abc");
	});
});

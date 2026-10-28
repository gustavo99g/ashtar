import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import {
	type ScreenShareController,
	useScreenShareState,
	useScreenShares,
} from "@/features/screen-share";
import { ShareRaceGuard } from "../components/ShareRaceGuard";

vi.mock("@/features/screen-share", () => ({
	useScreenShareState: vi.fn(),
	useScreenShares: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { add: vi.fn(() => "toast-1"), close: vi.fn() },
}));

const controller = {
	stop: vi.fn(() => Promise.resolve()),
} as unknown as ScreenShareController;

/** Uma publicação de tela: `local` é a minha; `name` é o nome visível de quem publicou. */
function share(identity: string, local: boolean, name = identity) {
	return { participant: { identity, isLocal: local, name } };
}

const mine = share("u1", true, "Eu");
const theirs = share("u2", false, "Lua");

function setShares(
	shares: ReturnType<typeof share>[],
	winner: ReturnType<typeof share> | undefined,
) {
	vi.mocked(useScreenShares).mockReturnValue({ shares, winner } as never);
}

function renderGuard() {
	return render(
		<MemoryRouter>
			<ShareRaceGuard controller={controller} />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.mocked(controller.stop).mockClear();
	vi.mocked(toast.add).mockClear();
	vi.mocked(useScreenShareState).mockReturnValue({
		status: "active",
		sessionId: 1,
	} as never);
});

describe("ShareRaceGuard", () => {
	it("quem perde para a outra pessoa para a própria transmissão e vê o aviso", () => {
		setShares([mine, theirs], theirs);

		renderGuard();

		expect(controller.stop).toHaveBeenCalledOnce();
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Lua começou a transmitir antes" }),
		);
	});

	it("quem ganha continua transmitindo, sem aviso", () => {
		setShares([mine, theirs], mine);

		renderGuard();

		expect(controller.stop).not.toHaveBeenCalled();
		expect(toast.add).not.toHaveBeenCalled();
	});

	it("sem transmitir, não faz nada", () => {
		vi.mocked(useScreenShareState).mockReturnValue({ status: "idle" } as never);
		setShares([theirs], theirs);

		renderGuard();

		expect(controller.stop).not.toHaveBeenCalled();
	});

	it("espera a própria publicação chegar à lista antes de comparar", () => {
		// A minha ainda não está na lista: comparar agora pararia a transmissão à toa.
		setShares([theirs], theirs);

		renderGuard();

		expect(controller.stop).not.toHaveBeenCalled();
		expect(toast.add).not.toHaveBeenCalled();
	});

	it("avisa uma vez só por transmissão, mesmo com a lista mudando", () => {
		setShares([mine, theirs], theirs);
		const view = renderGuard();

		setShares([mine, theirs, share("u3", false)], theirs);
		view.rerender(
			<MemoryRouter>
				<ShareRaceGuard controller={controller} />
			</MemoryRouter>,
		);

		expect(controller.stop).toHaveBeenCalledOnce();
		expect(toast.add).toHaveBeenCalledOnce();
	});
});

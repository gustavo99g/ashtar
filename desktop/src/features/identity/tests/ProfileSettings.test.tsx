import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApiError,
	deleteSavedAvatar,
	listSavedAvatars,
	type MeResponse,
	setAvatar,
	updateMe,
} from "@/lib/api";
import { ProfileSettings } from "../components/ProfileSettings";
import { identityKeys } from "../queries";
import { useSessionStore } from "../stores/sessionStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	updateMe: vi.fn(),
	listSavedAvatars: vi.fn(() => Promise.resolve([])),
	setAvatar: vi.fn(),
	deleteSavedAvatar: vi.fn(() => Promise.resolve()),
}));

function me(displayName: string | null): MeResponse {
	const user = {
		id: "u1",
		nick: "kid",
		display_name: displayName,
		is_owner: true,
	};
	return {
		user,
		permissions: [],
		update_channel: "beta",
		status: "available",
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: true,
		can_move_members: true, can_manage_emojis: false, can_view_logs: false,
	};
}

function renderProfile(displayName: string | null = null, inCall = false) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	queryClient.setQueryData(identityKeys.me(), me(displayName));
	render(
		<QueryClientProvider client={queryClient}>
			<ProfileSettings inCall={inCall} />
		</QueryClientProvider>,
	);
	return queryClient;
}

function nameField() {
	return screen.getByRole("textbox", { name: "Nome visível" });
}

beforeEach(() => {
	useSessionStore.setState({
		session: { status: "connected", user: me(null).user },
	});
	vi.mocked(updateMe).mockReset();
});

describe("ProfileSettings", () => {
	it("sem nome visível, o campo fica vazio e a prévia mostra o nick", () => {
		renderProfile();
		expect(nameField()).toHaveValue("");
		expect(nameField()).toHaveAttribute("placeholder", "kid");
		expect(
			screen.getByText("Em branco, aparece o seu nick."),
		).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "Nick" })).toHaveTextContent(
			"kid",
		);
		expect(
			screen.queryByRole("region", { name: "Alterações não salvas" }),
		).not.toBeInTheDocument();
	});

	it("salva o nome sem os espaços das pontas e atualiza o cache", async () => {
		vi.mocked(updateMe).mockResolvedValue(me("Kid do Ashtar"));
		const queryClient = renderProfile();

		fireEvent.change(nameField(), { target: { value: "  Kid do Ashtar " } });
		expect(screen.getByText("16/32")).toBeInTheDocument();
		expect(screen.getAllByText("Kid do Ashtar")).toHaveLength(3);
		expect(
			screen.getByText("Você tem alterações que não foram salvas."),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
		// O TanStack Query chama a função da mutação no tique seguinte.
		await vi.waitFor(() =>
			expect(updateMe).toHaveBeenCalledWith({ display_name: "Kid do Ashtar" }),
		);

		await vi.waitFor(() =>
			expect(
				screen.queryByRole("region", { name: "Alterações não salvas" }),
			).not.toBeInTheDocument(),
		);
		expect(nameField()).toHaveValue("Kid do Ashtar");
		expect(
			queryClient.getQueryData<MeResponse>(identityKeys.me())?.user
				.display_name,
		).toBe("Kid do Ashtar");
	});

	it("apagar o nome manda null, para voltar ao nick", async () => {
		vi.mocked(updateMe).mockResolvedValue(me(null));
		renderProfile("Kid");

		fireEvent.change(nameField(), { target: { value: "   " } });
		fireEvent.submit(nameField());
		await vi.waitFor(() =>
			expect(updateMe).toHaveBeenCalledWith({ display_name: null }),
		);
	});

	it("o invalid_display_name aparece no campo, com a mensagem da API", async () => {
		const message = "O nome visível não pode ter dois espaços seguidos.";
		vi.mocked(updateMe).mockRejectedValue(
			new ApiError({ status: 400, kind: "invalid_display_name", message }),
		);
		renderProfile();

		fireEvent.change(nameField(), { target: { value: "Kid  Ashtar" } });
		fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

		expect(await screen.findByText(message)).toBeInTheDocument();
		expect(nameField()).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
	});

	it("outra falha vira a barra vermelha, e o Desfazer volta o nome anterior", async () => {
		vi.mocked(updateMe).mockRejectedValue(
			new ApiError({ status: 0, kind: "network", message: "sem internet" }),
		);
		renderProfile("Kid");

		fireEvent.change(nameField(), { target: { value: "Kid novo" } });
		fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

		expect(
			await screen.findByText("Não deu para salvar. Tente de novo."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Tentar de novo" }),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
		expect(nameField()).toHaveValue("Kid");
		expect(
			screen.queryByRole("region", { name: "Alterações não salvas" }),
		).not.toBeInTheDocument();
	});

	it("numa chamada, avisa que na sala o nome vale na próxima entrada", () => {
		renderProfile(null, true);
		expect(
			screen.getByText(
				"Você está numa chamada: na sala, o nome novo vale na próxima entrada.",
			),
		).toBeInTheDocument();
	});

	it("as fotos anteriores: clicar volta a uma, o X apaga; a de agora não aparece", async () => {
		vi.mocked(listSavedAvatars).mockResolvedValue([
			{ file_id: "agora", used_at: 3 },
			{ file_id: "antiga", used_at: 2 },
		]);
		const current = me(null);
		current.user = { ...current.user, avatar: "agora" };
		vi.mocked(setAvatar).mockResolvedValue({
			...current,
			user: { ...current.user, avatar: "antiga" },
		});
		const queryClient = renderProfile();
		queryClient.setQueryData(identityKeys.me(), current);

		const list = await screen.findByRole("list", { name: "Fotos anteriores" });
		expect(list.querySelectorAll("li")).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Usar esta foto" }));
		await vi.waitFor(() => expect(setAvatar).toHaveBeenCalledWith("antiga"));
		await vi.waitFor(() =>
			expect(
				queryClient.getQueryData<MeResponse>(identityKeys.me())?.user.avatar,
			).toBe("antiga"),
		);

		vi.mocked(listSavedAvatars).mockResolvedValue([
			{ file_id: "antiga", used_at: 4 },
			{ file_id: "agora", used_at: 3 },
		]);
		await vi.waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Apagar esta foto" }),
			).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Apagar esta foto" }));
		await vi.waitFor(() =>
			expect(deleteSavedAvatar).toHaveBeenCalledWith("agora"),
		);
	});
});

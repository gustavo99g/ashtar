import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchFile,
	type MeResponse,
	removeAvatar,
	type UserView,
} from "@/lib/api";
import { clearFileCache } from "@/lib/fileCache";
import { Avatar } from "../components/Avatar";
import { ProfileSettings } from "../components/ProfileSettings";
import { identityKeys } from "../queries";
import { handleIdentityRealtime } from "../realtime";
import {
	clearAvatars,
	rememberAvatars,
	useAvatarStore,
} from "../stores/avatarStore";
import { useSessionStore } from "../stores/sessionStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	fetchFile: vi.fn(),
	removeAvatar: vi.fn(),
}));

const kid: UserView = {
	id: "u1",
	nick: "kid",
	display_name: "Kid",
	is_owner: true,
	avatar: null,
};

function me(user: UserView = kid): MeResponse {
	return {
		user,
		permissions: [],
		update_channel: "stable",
		status: "available",
		can_create_invite: true,
		can_view_panel: true,
		can_manage_channels: false,
		can_move_members: false, can_manage_emojis: false,
	};
}

beforeEach(() => {
	clearAvatars();
	clearFileCache();
	URL.createObjectURL = vi.fn(() => "blob:foto");
	URL.revokeObjectURL = vi.fn();
	vi.mocked(fetchFile).mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
	useSessionStore.setState({ session: { status: "connected", user: kid } });
});

describe("a foto no avatar", () => {
	it("sem foto, a letra; com a foto conhecida do nick, a imagem", async () => {
		const { container, rerender } = render(<Avatar nick="Ana" />);
		expect(container).toHaveTextContent("A");
		expect(container.querySelector("img")).toBeNull();

		rememberAvatars([{ id: "u2", nick: "ana", avatar: "f1" }]);
		rerender(<Avatar nick="Ana" />);
		await vi.waitFor(() =>
			expect(container.querySelector("img")).toHaveAttribute("src", "blob:foto"),
		);
		expect(fetchFile).toHaveBeenCalledWith("f1");
	});

	it("se a imagem não abre, volta a letra", async () => {
		const { container } = render(<Avatar nick="ana" avatar="f1" />);
		const image = await vi.waitFor(() => {
			const found = container.querySelector("img");
			if (!found) throw new Error("sem img");
			return found;
		});
		fireEvent.error(image);
		expect(container.querySelector("img")).toBeNull();
		expect(container).toHaveTextContent("A");
	});

	it("user.updated troca a foto do nick e o meu /api/me", () => {
		rememberAvatars([kid, { id: "u2", nick: "ana", avatar: null }]);
		const client = new QueryClient();
		client.setQueryData(identityKeys.me(), me());
		handleIdentityRealtime(
			{ type: "user.updated", id: "u1", display_name: "K", avatar: "f9" },
			client,
		);
		expect(useAvatarStore.getState().byNick).toEqual({ kid: "f9", ana: null });
		expect(client.getQueryData<MeResponse>(identityKeys.me())?.user).toMatchObject(
			{ display_name: "K", avatar: "f9" },
		);
	});
});

describe("Configurações › Perfil: a foto", () => {
	function renderProfile(user: UserView) {
		const client = new QueryClient({
			defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
		});
		client.setQueryData(identityKeys.me(), me(user));
		render(
			<QueryClientProvider client={client}>
				<ProfileSettings inCall={false} />
			</QueryClientProvider>,
		);
		return client;
	}

	it("escolher uma imagem abre o recorte", async () => {
		renderProfile(kid);
		expect(
			screen.queryByRole("button", { name: "Remover foto" }),
		).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Escolher a foto"), {
			target: {
				files: [new File(["x"], "eu.png", { type: "image/png" })],
			},
		});
		expect(
			await screen.findByRole("dialog", { name: "Recortar a foto" }),
		).toBeInTheDocument();
		expect(screen.getByRole("slider", { name: "Zoom" })).toBeInTheDocument();
	});

	it("Remover foto tira a foto e volta a letra", async () => {
		vi.mocked(removeAvatar).mockResolvedValue(me(kid));
		const client = renderProfile({ ...kid, avatar: "f1" });
		fireEvent.click(screen.getByRole("button", { name: "Remover foto" }));
		await vi.waitFor(() => expect(removeAvatar).toHaveBeenCalled());
		await vi.waitFor(() =>
			expect(
				client.getQueryData<MeResponse>(identityKeys.me())?.user.avatar,
			).toBeNull(),
		);
		expect(
			screen.getByRole("button", { name: "Escolher foto" }),
		).toBeInTheDocument();
	});
});

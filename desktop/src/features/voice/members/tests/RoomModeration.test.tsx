import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/identity";
import {
	disconnectMember,
	getChannelLayout,
	getMe,
	type MeResponse,
	moderateStopShare,
	moveMember,
	setServerMute,
	setSoundsBlocked,
} from "@/lib/api";
import { RoomModeration } from "../components/RoomModeration";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	getMe: vi.fn(),
	getChannelLayout: vi.fn(),
	moveMember: vi.fn(),
	disconnectMember: vi.fn(),
	setServerMute: vi.fn(),
	setSoundsBlocked: vi.fn(),
	moderateStopShare: vi.fn(),
}));

const me = (canMove: boolean, canModerate = false): MeResponse => ({
	user: { id: "kid", nick: "kid", display_name: null, is_owner: false },
	permissions: [],
	update_channel: "stable",
	status: "available",
	can_create_invite: false,
	can_view_panel: false,
	can_manage_channels: false,
	can_move_members: canMove, can_manage_emojis: false, can_view_logs: false, can_moderate_voice: canModerate, can_send_sounds: false, can_approve_sounds: false, can_stream_from_device: false,
});

const room = (id: string, name: string) => ({
	id,
	kind: "voice" as const,
	name,
	topic: null,
	category_id: "voz",
	archived_at: null,
	restricted: false,
});

function renderModeration(
	onDone = vi.fn(),
	member: { sharing?: boolean; serverMuted?: boolean; soundsBlocked?: boolean } = {},
	people: { id: string; is_owner: boolean }[] = [],
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(["chat", "people"], people);
	render(
		<QueryClientProvider client={client}>
			<RoomModeration
				userId="juju"
				name="Júlia"
				roomId="sala"
				roomName="Jogatina"
				member={member}
				onDone={onDone}
			/>
		</QueryClientProvider>,
	);
	return onDone;
}

beforeEach(() => {
	useSessionStore.setState({
		session: {
			status: "connected",
			user: { id: "kid", nick: "kid", display_name: null, is_owner: false },
		},
	});
	vi.mocked(getChannelLayout).mockResolvedValue({
		version: 1,
		top: [],
		categories: [
			{
				id: "voz",
				name: "Voz",
				channels: [room("sala", "Sala"), room("squad", "Squad")],
			},
		],
	});
	vi.mocked(moveMember).mockResolvedValue();
	vi.mocked(disconnectMember).mockResolvedValue();
});

describe("mover e desconectar pelo cartão", () => {
	it("sem a permissão, a seção não aparece", async () => {
		vi.mocked(getMe).mockResolvedValue(me(false));
		renderModeration();
		await vi.waitFor(() => expect(getMe).toHaveBeenCalled());
		expect(screen.queryByText("Mover para")).not.toBeInTheDocument();
		expect(screen.queryByText("Desconectar da voz")).not.toBeInTheDocument();
	});

	it("Mover para lista as outras salas e pede a troca", async () => {
		vi.mocked(getMe).mockResolvedValue(me(true));
		const user = userEvent.setup();
		const onDone = renderModeration();
		const trigger = await screen.findByRole("button", { name: "Mover para" });
		// As salas chegam depois do cartão: o botão só abre com elas.
		await vi.waitFor(() => expect(trigger).toBeEnabled());
		await user.click(trigger);
		const menu = await screen.findByRole("menu", { name: "Mover para" });
		expect(menu).toHaveTextContent("Squad");
		expect(menu).not.toHaveTextContent("Sala");
		await user.click(screen.getByRole("menuitem", { name: "Squad" }));
		expect(moveMember).toHaveBeenCalledWith("juju", "squad");
		expect(onDone).toHaveBeenCalled();
	});

	it("Mover para não oferece a sala restrita de que a pessoa está fora", async () => {
		vi.mocked(getMe).mockResolvedValue(me(true));
		vi.mocked(getChannelLayout).mockResolvedValue({
			version: 1,
			top: [],
			categories: [
				{
					id: "voz",
					name: "Voz",
					channels: [
						room("sala", "Sala"),
						room("squad", "Squad"),
						{ ...room("vip", "VIP"), restricted: true, member_ids: ["kid"] },
						{ ...room("time", "Time"), restricted: true, member_ids: ["juju"] },
					],
				},
			],
		});
		const user = userEvent.setup();
		renderModeration();
		const trigger = await screen.findByRole("button", { name: "Mover para" });
		await vi.waitFor(() => expect(trigger).toBeEnabled());
		await user.click(trigger);
		const menu = await screen.findByRole("menu", { name: "Mover para" });
		expect(menu).toHaveTextContent("Squad");
		expect(menu).toHaveTextContent("Time");
		expect(menu).not.toHaveTextContent("VIP");
	});

	it("Desconectar da voz pede à API e fecha o cartão", async () => {
		vi.mocked(getMe).mockResolvedValue(me(true));
		const user = userEvent.setup();
		const onDone = renderModeration();
		await user.click(
			await screen.findByRole("button", { name: "Desconectar da voz" }),
		);
		expect(disconnectMember).toHaveBeenCalledWith("juju");
		await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
	});
});

describe("moderar a voz pelo cartão", () => {
	beforeEach(() => {
		vi.mocked(setServerMute).mockResolvedValue();
		vi.mocked(moderateStopShare).mockResolvedValue();
	});

	it("Silenciar microfone é uma chave que pede à API", async () => {
		vi.mocked(getMe).mockResolvedValue(me(false, true));
		const user = userEvent.setup();
		renderModeration(vi.fn(), { serverMuted: false });
		const toggle = await screen.findByRole("switch", {
			name: "Silenciar microfone",
		});
		// Sem "Mover membros", só a moderação.
		expect(screen.queryByText("Desconectar da voz")).not.toBeInTheDocument();
		await user.click(toggle);
		expect(setServerMute).toHaveBeenCalledWith("juju", true);
		expect(toggle).toBeChecked();
	});

	it("Bloquear sons é uma chave: ligada, libera", async () => {
		vi.mocked(getMe).mockResolvedValue(me(false, true));
		vi.mocked(setSoundsBlocked).mockResolvedValue();
		const user = userEvent.setup();
		renderModeration(vi.fn(), { soundsBlocked: true });
		const toggle = await screen.findByRole("switch", { name: "Bloquear sons" });
		expect(toggle).toBeChecked();
		await user.click(toggle);
		expect(setSoundsBlocked).toHaveBeenCalledWith("juju", false);
		expect(toggle).not.toBeChecked();
	});

	it("Encerrar transmissão pergunta antes, e o Shift pula", async () => {
		vi.mocked(getMe).mockResolvedValue(me(false, true));
		const user = userEvent.setup();
		const onDone = renderModeration(vi.fn(), { sharing: true });
		await user.click(
			await screen.findByRole("button", { name: "Encerrar transmissão" }),
		);
		expect(
			await screen.findByText("Encerrar a transmissão de Júlia?"),
		).toBeInTheDocument();
		expect(moderateStopShare).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Encerrar" }));
		expect(moderateStopShare).toHaveBeenCalledWith("juju");
		await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

		vi.mocked(moderateStopShare).mockClear();
		await user.keyboard("{Shift>}");
		await user.click(
			screen.getByRole("button", { name: "Encerrar transmissão" }),
		);
		await user.keyboard("{/Shift}");
		expect(moderateStopShare).toHaveBeenCalledWith("juju");
		expect(screen.queryByText("Encerrar a transmissão de Júlia?")).toBeNull();
	});

	it("ninguém modera o dono", async () => {
		vi.mocked(getMe).mockResolvedValue(me(true, true));
		renderModeration(vi.fn(), {}, [{ id: "juju", is_owner: true }]);
		await vi.waitFor(() => expect(getMe).toHaveBeenCalled());
		expect(screen.queryByText("Moderação")).not.toBeInTheDocument();
		expect(screen.queryByText("Mover para")).not.toBeInTheDocument();
	});
});

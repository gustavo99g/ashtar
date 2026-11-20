/**
 * Todas as rotas, cada uma com a sua tela. Desde a 0.2.3, `/server` só redireciona para o último
 * canal de texto (`/channels/:channelId`).
 *
 * Router de memória: o app não tem barra de endereço, o link do convite chega pelo deep link
 * (Etapa 4) e o token só vive na memória, então toda abertura começa em "Entrando…" (`/`).
 * Os caminhos vêm de `@/lib/paths`; o `router.test.tsx` confere que cada um tem rota.
 */
import {
	createMemoryRouter,
	Navigate,
	type RouteObject,
} from "react-router-dom";
import { RequireNoAccount } from "@/features/entry";
import { AppShell } from "@/layouts/AppShell";
import { RootLayout } from "@/layouts/RootLayout";
import { SettingsLayout } from "@/layouts/SettingsLayout";
import { ChannelRoute } from "@/routes/channel";
import {
	AlreadyInRoute,
	InviteRoute,
	LeftGroupRoute,
	NoInviteRoute,
	RecoveryRoute,
} from "@/routes/entry";
import { ServerRoute } from "@/routes/server";
import {
	AppSettingsRoute,
	ArchivedSettingsRoute,
	InvitesSettingsRoute,
	MembersSettingsRoute,
	NotificationsSettingsRoute,
	ProfileSettingsRoute,
	ShortcutsSettingsRoute,
	VoiceSettingsRoute,
} from "@/routes/settings";
import { StartRoute } from "@/routes/start";
import { VoiceRoomRoute } from "@/routes/voice-room";

export const routes: RouteObject[] = [
	{
		element: <RootLayout />,
		children: [
			{ path: "/", element: <StartRoute /> },
			{
				path: "/entry",
				children: [
					{
						// Quem já tem conta não vê as telas de convite (`RequireNoAccount`).
						element: <RequireNoAccount />,
						children: [
							{ path: "no-invite", element: <NoInviteRoute /> },
							{ path: "invite/:code", element: <InviteRoute /> },
							{ path: "recovery/:code", element: <RecoveryRoute /> },
							{ path: "left", element: <LeftGroupRoute /> },
						],
					},
					{ path: "already-in", element: <AlreadyInRoute /> },
				],
			},
			{
				element: <AppShell />,
				children: [
					{ path: "/server", element: <ServerRoute /> },
					{ path: "/room", element: <VoiceRoomRoute /> },
					{ path: "/channels/:channelId", element: <ChannelRoute /> },
					{
						path: "/settings",
						element: <SettingsLayout />,
						children: [
							{ index: true, element: <Navigate to="profile" replace /> },
							{ path: "profile", element: <ProfileSettingsRoute /> },
							{ path: "voice", element: <VoiceSettingsRoute /> },
							{ path: "shortcuts", element: <ShortcutsSettingsRoute /> },
							{
								path: "notifications",
								element: <NotificationsSettingsRoute />,
							},
							{ path: "app", element: <AppSettingsRoute /> },
							{ path: "invites", element: <InvitesSettingsRoute /> },
							{ path: "members", element: <MembersSettingsRoute /> },
							{ path: "archived", element: <ArchivedSettingsRoute /> },
						],
					},
				],
			},
		],
	},
];

export const router = createMemoryRouter(routes);

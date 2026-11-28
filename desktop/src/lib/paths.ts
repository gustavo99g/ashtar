/**
 * Os endereços das telas, num lugar só. O `app/router.tsx` declara as rotas com estes caminhos,
 * e quem navega (telas, features) usa estas constantes em vez de escrever a string. Fica em
 * `lib/` porque as features podem importar daqui, e não podem importar o `app/`.
 */
export const paths = {
	/** "Entrando…": a abertura do app. */
	start: "/",
	entry: {
		noInvite: "/entry/no-invite",
		invite: (code: string) => `/entry/invite/${encodeURIComponent(code)}`,
		recovery: (code: string) => `/entry/recovery/${encodeURIComponent(code)}`,
		alreadyIn: "/entry/already-in",
		leftGroup: "/entry/left",
	},
	/** Abre o último canal de texto (o `ServerRoute` redireciona). */
	server: "/server",
	/** Um canal de texto. */
	channel: (id: string) => `/channels/${encodeURIComponent(id)}`,
	/** O padrão da rota de um canal, para o router e para o `useMatch`. */
	channelPattern: "/channels/:channelId",
	voiceRoom: "/room",
	settings: {
		root: "/settings",
		profile: "/settings/profile",
		voice: "/settings/voice",
		devices: "/settings/devices",
		shortcuts: "/settings/shortcuts",
		activity: "/settings/activity",
		notifications: "/settings/notifications",
		app: "/settings/app",
		invites: "/settings/invites",
		members: "/settings/members",
		/** Painel › Logs e Servidor: só do dono (v0.6). */
		logs: "/settings/logs",
		server: "/settings/server",
		audit: "/settings/audit",
		/** Servidor › Arquivados: só no menu de quem gerencia os canais. */
		archived: "/settings/archived",
		/** Servidor › Sons: quem envia ou aprova sons (v0.9). */
		sounds: "/settings/sounds",
		/** Painel › Emojis: quem tem "Gerenciar emojis" (v0.7). */
		emojis: "/settings/emojis",
	},
} as const;

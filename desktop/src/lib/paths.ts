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
	server: "/server",
	voiceRoom: "/room",
	settings: {
		root: "/settings",
		profile: "/settings/profile",
		voice: "/settings/voice",
		app: "/settings/app",
		invites: "/settings/invites",
		members: "/settings/members",
	},
} as const;

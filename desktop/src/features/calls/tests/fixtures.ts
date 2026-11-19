import type { Author, CallView } from "@/lib/api";

export const kid: Author = {
	id: "kid",
	nick: "kid",
	display_name: "Kid",
	removed: false,
};
export const ana: Author = {
	id: "ana",
	nick: "ana",
	display_name: null,
	removed: false,
};

/** Uma ligação do Kid para a Ana na conversa `d1`. */
export function callView(overrides: Partial<CallView> = {}): CallView {
	return {
		id: "c1",
		channel_id: "d1",
		caller: kid,
		callee: ana,
		outcome: "ringing",
		created_at: 1_000,
		answered_at: null,
		...overrides,
	};
}

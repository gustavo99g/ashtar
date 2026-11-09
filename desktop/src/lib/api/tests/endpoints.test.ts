import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "../config";
import {
	createInvite,
	getInvite,
	listInvites,
	revokeInvite,
} from "../endpoints/invites";
import { getMe, updateMe } from "../endpoints/me";
import {
	createRecoveryInvite,
	getMemberPermissions,
	listMembers,
	removeMember,
	setMemberBeta,
	unlinkMember,
} from "../endpoints/members";
import {
	createScreenToken,
	createVoiceToken,
	listVoiceParticipants,
} from "../endpoints/voice";

vi.mock("@/lib/tauri/commands", () => ({ checkForUpdate: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	// O corpo não importa aqui: o teste confere só o pedido.
	fetchMock.mockImplementation(async () => new Response("{}"));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	fetchMock.mockReset();
	vi.unstubAllGlobals();
});

describe("funções da API", () => {
	it.each<[string, string, string, unknown, () => Promise<unknown>]>([
		["getMe", "GET", "/api/me", undefined, () => getMe()],
		[
			"updateMe",
			"PATCH",
			"/api/me",
			{ display_name: "Kid" },
			() => updateMe({ display_name: "Kid" }),
		],
		[
			"getInvite",
			"GET",
			"/api/invites/7KQ2%20M9XD%2F4",
			undefined,
			() => getInvite("7KQ2 M9XD/4"),
		],
		[
			"createInvite",
			"POST",
			"/api/invites",
			{ preset: "group" },
			() => createInvite({ preset: "group" }),
		],
		["listInvites", "GET", "/api/invites", undefined, () => listInvites()],
		[
			"revokeInvite",
			"POST",
			"/api/invites/abc/revoke",
			undefined,
			() => revokeInvite("abc"),
		],
		["listMembers", "GET", "/api/members", undefined, () => listMembers()],
		[
			"getMemberPermissions",
			"GET",
			"/api/members/u1/permissions",
			undefined,
			() => getMemberPermissions("u1"),
		],
		[
			"setMemberBeta",
			"PUT",
			"/api/members/u1/beta",
			{ enabled: true },
			() => setMemberBeta("u1", true),
		],
		[
			"unlinkMember",
			"POST",
			"/api/members/u1/unlink",
			undefined,
			() => unlinkMember("u1"),
		],
		[
			"createRecoveryInvite",
			"POST",
			"/api/members/u1/recovery-invite",
			undefined,
			() => createRecoveryInvite("u1"),
		],
		[
			"removeMember",
			"DELETE",
			"/api/members/u1",
			undefined,
			() => removeMember("u1"),
		],
		[
			"listVoiceParticipants",
			"GET",
			"/api/voice/participants?channel_id=jogatina",
			undefined,
			() => listVoiceParticipants("jogatina"),
		],
		[
			"createVoiceToken",
			"POST",
			"/api/voice/token",
			{ channel_id: "jogatina" },
			() => createVoiceToken("jogatina"),
		],
		[
			"createScreenToken",
			"POST",
			"/api/voice/screen-token",
			{ channel_id: "jogatina" },
			() => createScreenToken("jogatina"),
		],
	])("%s: %s %s", async (_name, method, path, body, call) => {
		await call();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(apiUrl(path));
		expect(init?.method ?? "GET").toBe(method);
		if (body === undefined) {
			expect(init?.body).toBeUndefined();
		} else {
			expect(JSON.parse(String(init?.body))).toEqual(body);
			expect(new Headers(init?.headers).get("Content-Type")).toBe(
				"application/json",
			);
		}
	});
});

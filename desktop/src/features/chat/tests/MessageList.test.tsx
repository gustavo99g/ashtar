import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/api";
import { MessageList } from "../components/MessageList";
import type { PendingMessage } from "../stores/outboxStore";

vi.mock("@/lib/tauri/opener", () => ({ openLink: vi.fn() }));

/** O jsdom não tem layout: as medidas e a rolagem da lista vêm daqui. */
const box = { scrollHeight: 0, clientHeight: 0, scrollTop: 0 };
const original = {
	scrollHeight: Object.getOwnPropertyDescriptor(
		Element.prototype,
		"scrollHeight",
	),
	clientHeight: Object.getOwnPropertyDescriptor(
		Element.prototype,
		"clientHeight",
	),
	scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
};

beforeEach(() => {
	Object.assign(box, { scrollHeight: 0, clientHeight: 0, scrollTop: 0 });
	for (const key of ["scrollHeight", "clientHeight"] as const) {
		Object.defineProperty(Element.prototype, key, {
			configurable: true,
			get: () => box[key],
		});
	}
	Object.defineProperty(Element.prototype, "scrollTop", {
		configurable: true,
		get: () => box.scrollTop,
		set: (value: number) => {
			box.scrollTop = value;
		},
	});
});

afterEach(() => {
	for (const [key, descriptor] of Object.entries(original)) {
		if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
	}
});

function message(id: string): Message {
	return {
		id,
		channel_id: "geral",
		client_id: id,
		author: { id: "u2", nick: "ana", display_name: null, removed: false },
		body: `mensagem ${id}`,
		mentions: [],
		created_at: Math.floor(Date.now() / 1000),
		kind: "text",
		call: null,
	};
}

function pendingMessage(clientId: string): PendingMessage {
	return {
		client_id: clientId,
		channel_id: "geral",
		body: "minha",
		created_at: Math.floor(Date.now() / 1000),
		status: "sending",
	};
}

function list(
	messages: Message[],
	pending: PendingMessage[] = [],
	extra: {
		hasOlder?: boolean;
		onLoadOlder?: () => void;
		unreadAfter?: string | null;
		onSeeingEndChange?: (seeingEnd: boolean) => void;
	} = {},
) {
	return (
		<MessageList
			label="Mensagens em #geral"
			start={<p>Bem-vindo a #geral</p>}
			messages={messages}
			pending={pending}
			ownerId={null}
			hasOlder={extra.hasOlder ?? false}
			loadingOlder={false}
			onLoadOlder={extra.onLoadOlder ?? (() => {})}
			onRetry={() => {}}
			onDiscard={() => {}}
			unreadAfter={extra.unreadAfter}
			onSeeingEndChange={extra.onSeeingEndChange}
		/>
	);
}

/** Uma conversa comprida com quem lê lá em cima, longe do fim. */
function scrolledUp() {
	box.scrollHeight = 1000;
	box.clientHeight = 100;
	const view = render(list([message("m1"), message("m2")]));
	box.scrollTop = 0;
	fireEvent.scroll(screen.getByTestId("message-list"));
	return view;
}

describe("MessageList: o fim da conversa", () => {
	it("quem lê o histórico não é puxado para o fim por mensagem dos outros", () => {
		const view = scrolledUp();
		view.rerender(list([message("m1"), message("m2"), message("m3")]));
		expect(box.scrollTop).toBe(0);
		expect(
			screen.getByRole("button", { name: "Novas mensagens" }),
		).toBeInTheDocument();
	});

	it("mandar uma mensagem leva até o fim, mesmo com a conversa rolada para cima", () => {
		const view = scrolledUp();
		view.rerender(list([message("m1"), message("m2")], [pendingMessage("c1")]));
		expect(box.scrollTop).toBe(1000);
		expect(
			screen.queryByRole("button", { name: "Novas mensagens" }),
		).not.toBeInTheDocument();
	});
});

describe("MessageList: o histórico antigo", () => {
	it("a conversa que não enche a tela busca a página anterior sem esperar a rolagem", () => {
		box.scrollHeight = 50;
		box.clientHeight = 400;
		const onLoadOlder = vi.fn();
		render(list([message("m1")], [], { hasOlder: true, onLoadOlder }));
		expect(onLoadOlder).toHaveBeenCalledTimes(1);
	});

	it("com a tela cheia, só busca quando a rolagem chega perto do topo", () => {
		box.scrollHeight = 2000;
		box.clientHeight = 400;
		const onLoadOlder = vi.fn();
		render(list([message("m1")], [], { hasOlder: true, onLoadOlder }));
		expect(onLoadOlder).not.toHaveBeenCalled();

		box.scrollTop = 100;
		act(() => {
			fireEvent.scroll(screen.getByTestId("message-list"));
		});
		expect(onLoadOlder).toHaveBeenCalledTimes(1);
	});

	it("sem mais histórico, ou antes de ter altura, não busca", () => {
		const onLoadOlder = vi.fn();
		box.scrollHeight = 50;
		box.clientHeight = 400;
		render(list([message("m1")], [], { hasOlder: false, onLoadOlder }));
		expect(onLoadOlder).not.toHaveBeenCalled();
		expect(screen.getByText("Bem-vindo a #geral")).toBeInTheDocument();
	});

	it("sem altura nenhuma (antes do layout), não decide nada", () => {
		const onLoadOlder = vi.fn();
		render(list([message("m1")], [], { hasOlder: true, onLoadOlder }));
		expect(onLoadOlder).not.toHaveBeenCalled();
	});
});

describe("MessageList: as novas mensagens", () => {
	const three = [message("m1"), message("m2"), message("m3")];

	function lineBefore(): string | null | undefined {
		const line = screen.queryByRole("separator", { name: "Novas mensagens" });
		return line?.nextElementSibling?.textContent;
	}

	it("a linha fica antes da primeira não lida; null é antes da primeira de todas", () => {
		const view = render(list(three, [], { unreadAfter: "m1" }));
		expect(lineBefore()).toContain("mensagem m2");
		view.unmount();

		render(list(three, [], { unreadAfter: null }));
		expect(lineBefore()).toContain("mensagem m1");
	});

	it("sem marca, ou com tudo lido, não há linha", () => {
		const view = render(list(three));
		expect(lineBefore()).toBeUndefined();
		view.rerender(list(three, [], { unreadAfter: "m3" }));
		expect(lineBefore()).toBeUndefined();
	});

	it("abre rolada na linha, e não no fim", () => {
		box.scrollHeight = 1000;
		box.clientHeight = 100;
		const offset = vi
			.spyOn(HTMLElement.prototype, "offsetTop", "get")
			.mockReturnValue(500);
		const seeing = vi.fn();
		render(list(three, [], { unreadAfter: "m1", onSeeingEndChange: seeing }));
		offset.mockRestore();

		expect(box.scrollTop).toBe(484);
		expect(seeing).toHaveBeenCalledWith(false);
		expect(
			screen.getByRole("button", { name: "Novas mensagens" }),
		).toBeInTheDocument();
	});

	it("avisa quando o fim sai e volta à vista", () => {
		box.scrollHeight = 1000;
		box.clientHeight = 100;
		const seeing = vi.fn();
		render(list(three, [], { onSeeingEndChange: seeing }));
		const scroller = screen.getByTestId("message-list");

		box.scrollTop = 0;
		fireEvent.scroll(scroller);
		expect(seeing).toHaveBeenLastCalledWith(false);

		box.scrollTop = 900;
		fireEvent.scroll(scroller);
		expect(seeing).toHaveBeenLastCalledWith(true);
		expect(seeing).toHaveBeenCalledTimes(2);
	});
});

describe("MessageList: as menções", () => {
	it("a menção vira selo, e a mensagem que menciona quem lê ganha destaque", () => {
		const people = new Map([
			["kid", { id: "kid", nick: "kid", display_name: "Kid" }],
			["bia", { id: "bia", nick: "bia", display_name: null }],
		]);
		render(
			<MessageList
				label="Mensagens em #geral"
				start={null}
				messages={[
					{ ...message("m1"), body: "fala @kid", mentions: ["kid"] },
					{ ...message("m2"), body: "e a @bia", mentions: ["bia"] },
					{ ...message("m3"), body: "@ninguem aqui" },
				]}
				pending={[]}
				ownerId={null}
				people={people}
				myId="kid"
				hasOlder={false}
				loadingOlder={false}
				onLoadOlder={() => {}}
				onRetry={() => {}}
				onDiscard={() => {}}
			/>,
		);
		expect(screen.getByText("@Kid").closest("li")).toHaveAttribute(
			"data-mentions-me",
			"true",
		);
		expect(screen.getByText("@bia").closest("li")).not.toHaveAttribute(
			"data-mentions-me",
		);
		expect(screen.getByText("@ninguem aqui")).toBeInTheDocument();
	});
});

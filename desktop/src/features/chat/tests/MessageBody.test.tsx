import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openLink } from "@/lib/tauri/opener";
import { MessageBody } from "../components/MessageBody";

vi.mock("@/lib/tauri/opener", () => ({ openLink: vi.fn() }));

const URL = "https://exemplo.com/a";

beforeEach(() => {
	vi.mocked(openLink).mockReset();
});

describe("MessageBody", () => {
	it("o texto é texto, nunca HTML, e as quebras de linha ficam", () => {
		const { container } = render(
			<MessageBody body={"<b>oi</b>\nsegunda linha"} />,
		);
		expect(container.querySelector("b")).toBeNull();
		expect(container.textContent).toBe("<b>oi</b>\nsegunda linha");
	});

	it("o clique comum abre pelo openLink, sem o WebView navegar", () => {
		render(<MessageBody body={`veja ${URL}`} />);
		const link = screen.getByRole("link", { name: URL });
		const notPrevented = fireEvent.click(link);
		expect(notPrevented).toBe(false);
		expect(openLink).toHaveBeenCalledWith(URL);
	});

	it("o clique do meio também abre pelo openLink, e o do botão direito não", () => {
		render(<MessageBody body={URL} />);
		const link = screen.getByRole("link", { name: URL });

		const middle = new MouseEvent("auxclick", {
			button: 1,
			bubbles: true,
			cancelable: true,
		});
		link.dispatchEvent(middle);
		expect(middle.defaultPrevented).toBe(true);
		expect(openLink).toHaveBeenCalledTimes(1);
		expect(openLink).toHaveBeenCalledWith(URL);

		const right = new MouseEvent("auxclick", {
			button: 2,
			bubbles: true,
			cancelable: true,
		});
		link.dispatchEvent(right);
		expect(right.defaultPrevented).toBe(true);
		expect(openLink).toHaveBeenCalledTimes(1);
	});
});

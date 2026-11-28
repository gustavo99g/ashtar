import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DevicePicture, isOdin } from "../components/DevicePicture";

describe("a imagem do aparelho", () => {
	it("reconhece o Odin pelo nome", () => {
		expect(isOdin("Odin 3")).toBe(true);
		expect(isOdin("AYN Odin3")).toBe(true);
		expect(isOdin("Retroid Pocket 5")).toBe(false);
	});

	it("o Odin ganha a foto; os outros, o controle", () => {
		const { container, rerender } = render(<DevicePicture name="Odin 3" size={20} />);
		expect(container.querySelector("img")).not.toBeNull();
		rerender(<DevicePicture name="Retroid" size={20} />);
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});
});

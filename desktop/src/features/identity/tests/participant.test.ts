import { describe, expect, it } from "vitest";
import { avatarInitial, nickColor } from "../model/nickColor";
import { nickFromMetadata, participantPerson } from "../model/participant";

describe("nickFromMetadata", () => {
	it("lê o nick que a API põe no token", () => {
		expect(nickFromMetadata('{"nick":"juliana"}')).toBe("juliana");
	});

	it.each([
		["sem metadados", undefined],
		["vazio", ""],
		["que não é JSON", "juliana"],
		["sem o campo", '{"outro":"x"}'],
		["com o nick que não é texto", '{"nick":42}'],
		["com o nick em branco", '{"nick":"  "}'],
		["com um JSON que não é objeto", '"juliana"'],
	])("%s fica sem nick", (_, metadata) => {
		expect(nickFromMetadata(metadata)).toBeNull();
	});
});

describe("participantPerson", () => {
	it("o nome é o nome visível, e a cor e a letra saem do nick", () => {
		const person = participantPerson({
			identity: "u1",
			name: "juju",
			metadata: '{"nick":"juliana"}',
		});

		expect(person).toEqual({ id: "u1", nick: "juliana", name: "juju" });
		expect(nickColor(person.nick)).toBe(nickColor("juliana"));
		expect(avatarInitial(person.nick, person.name)).toBe("J");
	});

	it("sem nome visível, aparece o nick", () => {
		expect(
			participantPerson({
				identity: "u1",
				name: "",
				metadata: '{"nick":"kid"}',
			}),
		).toEqual({
			id: "u1",
			nick: "kid",
			name: "kid",
		});
	});

	it("sem nick nos metadados, o nome faz as vezes de nick; sem nome, a identidade", () => {
		expect(participantPerson({ identity: "u1", name: "Rafa" })).toEqual({
			id: "u1",
			nick: "Rafa",
			name: "Rafa",
		});
		expect(participantPerson({ identity: "u1" })).toEqual({
			id: "u1",
			nick: "u1",
			name: "u1",
		});
	});
});

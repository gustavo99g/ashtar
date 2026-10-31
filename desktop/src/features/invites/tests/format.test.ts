import { describe, expect, it } from "vitest";
import {
	dayAndTime,
	duration,
	expiryTime,
	inviteAddress,
	peopleText,
	shortDate,
} from "../format";

/** 17 out de 2026, 12:15, no fuso do computador: o "agora" dos quadros. */
const now = new Date(2026, 9, 17, 12, 15).getTime();
const at = (day: number, hour: number, minute: number, month = 9) =>
	new Date(2026, month, day, hour, minute).getTime() / 1000;

describe("textos do bilhete", () => {
	it("tira o protocolo e o código do link", () => {
		expect(
			inviteAddress("https://ashtar.exemplo.ts.net/invite/7KQ2", "7KQ2"),
		).toBe("ashtar.exemplo.ts.net/invite/");
	});

	it("escreve a hora com dois dígitos", () => {
		const at = new Date(2026, 9, 18, 9, 5).getTime() / 1000;
		expect(expiryTime(at)).toBe("09:05");
	});
});

describe("datas e prazos", () => {
	it("escreve a data curta como no canvas", () => {
		expect(shortDate(at(24, 12, 15))).toBe("24 out");
		expect(shortDate(at(3, 8, 0, 2))).toBe("3 mar");
	});

	it("diz hoje, amanhã e ontem pelo dia do calendário", () => {
		expect(dayAndTime(at(17, 12, 20), now)).toBe("hoje, 12:20");
		expect(dayAndTime(at(18, 0, 5), now)).toBe("amanhã, 00:05");
		expect(dayAndTime(at(16, 18, 40), now)).toBe("ontem, 18:40");
		expect(dayAndTime(at(24, 12, 15), now)).toBe("24 out, 12:15");
	});

	it("arredonda os prazos para a unidade que cabe", () => {
		expect(duration(299)).toBe("5 minutos");
		expect(duration(60)).toBe("1 minuto");
		expect(duration(3599)).toBe("1 hora");
		expect(duration(5 * 3600)).toBe("5 horas");
		expect(duration(7 * 86_400 - 30)).toBe("7 dias");
		expect(duration(86_400)).toBe("1 dia");
	});

	it("conta as pessoas", () => {
		expect(peopleText(1)).toBe("1 pessoa");
		expect(peopleText(8)).toBe("até 8 pessoas");
	});
});

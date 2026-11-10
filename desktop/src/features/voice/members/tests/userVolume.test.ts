import { beforeEach, describe, expect, it } from "vitest";
import {
	heardVolume,
	setUserVolume,
	toggleUserMuted,
	useUserVolumes,
} from "../stores/userVolumeStore";

const heard = (id: string) => heardVolume(useUserVolumes.getState(), id);
const saved = () =>
	JSON.parse(localStorage.getItem("ashtar-user-volume") ?? "{}").state?.volumes;

describe("volume por pessoa", () => {
	beforeEach(() => {
		localStorage.clear();
		useUserVolumes.setState({ volumes: {} });
	});

	it("quem nunca foi ajustado está em 100%", () => {
		expect(heard("juju")).toBe(100);
	});

	it("cada pessoa tem o seu, de 0 a 200", () => {
		setUserVolume("juju", 80);
		setUserVolume("marcao", 180);
		setUserVolume("rafa", 999);

		expect(heard("juju")).toBe(80);
		expect(heard("marcao")).toBe(180);
		expect(heard("rafa")).toBe(200);
		expect(heard("lua")).toBe(100);
	});

	it("o alto-falante silencia só aquela pessoa e volta ao volume de antes", () => {
		setUserVolume("juju", 140);
		toggleUserMuted("juju");
		expect(heard("juju")).toBe(0);
		expect(heard("marcao")).toBe(100);

		toggleUserMuted("juju");
		expect(heard("juju")).toBe(140);
	});

	it("arrastar até o zero tira o som sem perder o volume de antes", () => {
		setUserVolume("juju", 30);
		setUserVolume("juju", 0);
		expect(heard("juju")).toBe(0);

		toggleUserMuted("juju");
		expect(heard("juju")).toBe(30);
	});

	it("só fica guardado quem saiu do padrão", () => {
		setUserVolume("juju", 80);
		toggleUserMuted("marcao");
		expect(saved()).toEqual({
			juju: { volume: 80, muted: false },
			marcao: { volume: 100, muted: true },
		});

		setUserVolume("juju", 100);
		toggleUserMuted("marcao");
		expect(saved()).toEqual({});
	});

	it("um valor estranho no disco é ignorado, sem derrubar os outros", async () => {
		localStorage.setItem(
			"ashtar-user-volume",
			JSON.stringify({
				state: {
					volumes: {
						juju: { volume: 80.4, muted: false },
						marcao: { volume: 900, muted: false },
						rafa: "alto",
						lua: { volume: 100, muted: false },
					},
				},
				version: 1,
			}),
		);

		await useUserVolumes.persist.rehydrate();

		expect(useUserVolumes.getState().volumes).toEqual({
			juju: { volume: 80, muted: false },
		});
	});
});

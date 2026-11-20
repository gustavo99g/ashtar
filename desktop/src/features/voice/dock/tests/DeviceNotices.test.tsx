import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { useAudioDevices } from "../../devices/hooks/useAudioDevices";
import type { AudioDevices } from "../../devices/model/devices";
import { useDeviceChoice } from "../../devices/stores/deviceChoiceStore";
import { useVoice } from "../../room/hooks/useVoice";
import { DeviceNotices } from "../components/DeviceNotices";

vi.mock("@/components/ui/toast", () => ({
	toast: { add: vi.fn(() => "aviso"), close: vi.fn() },
}));
vi.mock("../../devices/hooks/useAudioDevices", () => ({
	useAudioDevices: vi.fn(),
}));
vi.mock("../../room/hooks/useVoice", () => ({ useVoice: vi.fn() }));

const usb = { id: "usb", label: "Headset USB" };
const laptop = { id: "nb", label: "Microfone do notebook" };

function devices(input: AudioDevices["input"]): AudioDevices {
	return {
		input,
		output: [],
		defaults: { input: laptop.label, output: null },
		hidden: false,
	};
}

const unmute = vi.fn(async () => {});

function voice(error: { kind: string; message: string } | null = null) {
	vi.mocked(useVoice).mockReturnValue({ error, unmute } as never);
}

beforeEach(() => {
	vi.clearAllMocks();
	voice();
	useDeviceChoice.setState({ input: usb, output: null });
});

function titles() {
	return vi.mocked(toast.add).mock.calls.map(([options]) => options.title);
}

describe("os avisos dos dispositivos", () => {
	it("o microfone escolhido que some avisa com o padrão do Windows, e o aviso sai quando ele volta", () => {
		vi.mocked(useAudioDevices).mockReturnValue(devices([usb, laptop]));
		const { rerender } = render(<DeviceNotices />);
		expect(toast.add).not.toHaveBeenCalled();

		vi.mocked(useAudioDevices).mockReturnValue(devices([laptop]));
		rerender(<DeviceNotices />);
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Seu microfone foi desconectado",
				description: "Usando o padrão do Windows: Microfone do notebook",
			}),
		);

		vi.mocked(useAudioDevices).mockReturnValue(devices([usb, laptop]));
		rerender(<DeviceNotices />);
		expect(toast.close).toHaveBeenCalledWith("aviso");
	});

	it("entrar com o fone já desligado não avisa a queda", () => {
		vi.mocked(useAudioDevices).mockReturnValue(devices([laptop]));
		render(<DeviceNotices />);
		expect(titles()).toEqual([]);
	});

	it("sem microfone, avisa; quando um aparece, oferece ativar", () => {
		useDeviceChoice.setState({ input: null, output: null });
		voice({ kind: "microphone", message: "Nenhum microfone encontrado." });
		vi.mocked(useAudioDevices).mockReturnValue(devices([]));
		const { rerender } = render(<DeviceNotices />);
		expect(titles()).toEqual(["Microfone indisponível"]);

		vi.mocked(useAudioDevices).mockReturnValue(devices([laptop]));
		rerender(<DeviceNotices />);
		const found = vi.mocked(toast.add).mock.calls[1][0];
		expect(found.title).toBe("Um microfone foi conectado");
		found.actionProps?.onClick?.({} as never);
		expect(unmute).toHaveBeenCalled();
	});
});

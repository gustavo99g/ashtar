import type { ScreenShareController } from "../model/controller";
import {
	closeSharePanel,
	closeSourcePicker,
	usePickerStore,
} from "../stores/pickerStore";
import { SharePanel } from "./SharePanel";
import { SourcePicker } from "./SourcePicker";

/**
 * O seletor de fonte e o painel da transmissão, montados uma vez enquanto há chamada; abrem com
 * `openSourcePicker` e `openSharePanel`.
 */
export function SourcePickerHost({
	controller,
	channelName,
	ping,
}: {
	controller: ScreenShareController;
	channelName: string;
	/** O ping até o servidor, para o painel da transmissão (`null` sem sala). */
	ping: number | null;
}) {
	const open = usePickerStore((state) => state.open);
	const mode = usePickerStore((state) => state.mode);
	const panelOpen = usePickerStore((state) => state.panelOpen);
	return (
		<>
			<SourcePicker
				controller={controller}
				channelName={channelName}
				open={open}
				mode={mode}
				onClose={closeSourcePicker}
			/>
			<SharePanel
				controller={controller}
				open={panelOpen}
				onClose={closeSharePanel}
				ping={ping}
			/>
		</>
	);
}

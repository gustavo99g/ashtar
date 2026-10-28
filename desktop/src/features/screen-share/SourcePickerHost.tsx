import type { ScreenShareController } from "./controller";
import { closeSourcePicker, usePickerStore } from "./pickerStore";
import { SourcePicker } from "./SourcePicker";

/** O seletor de fonte, montado uma vez enquanto há chamada; abre com `openSourcePicker`. */
export function SourcePickerHost({
	controller,
	channelName,
}: {
	controller: ScreenShareController;
	channelName: string;
}) {
	const open = usePickerStore((state) => state.open);
	return (
		<SourcePicker
			controller={controller}
			channelName={channelName}
			open={open}
			onClose={closeSourcePicker}
		/>
	);
}

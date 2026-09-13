import { useNavigationStore } from "@/stores/navigation";

const textChannels = [
	{
		id: "general",
		name: "general",
	},
	{
		id: "random",
		name: "random",
	},
	{
		id: "development",
		name: "development",
	},
];

const voiceChannels = [
	{
		id: "general_voice",
		name: "General",
	},
	{
		id: "gaming",
		name: "Gaming",
	},
];

const Channel = () => {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
			<section>
				<h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted">
					Text Channels
				</h2>

				<div className="mt-1">
					{textChannels.map((channel) => (
						<ChannelItem
							id={channel.id}
							key={channel.id}
							type="text"
							name={channel.name}
						/>
					))}
				</div>
			</section>

			<section className="mt-5">
				<h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted">
					Voice Channels
				</h2>

				<div className="mt-1">
					{voiceChannels.map((channel) => (
						<ChannelItem
							id={channel.id}
							key={channel.id}
							type="voice"
							name={channel.name}
						/>
					))}
				</div>
			</section>
		</div>
	);
};

interface ChannelItemProps {
	id: string;
	name: string;
	type: "text" | "voice";
}

export function ChannelItem({ id, name, type }: ChannelItemProps) {
	const currentView = useNavigationStore((state) => state.currentView);
	const voiceChannelId = useNavigationStore((state) => state.voiceChannelId);

	const setView = useNavigationStore((state) => state.setCurrentView);
	const joinVoiceChannel = useNavigationStore(
		(state) => state.joinVoiceChannel,
	);

	const active = currentView.type === type && currentView.channelId === id;
	const connected = type === "voice" && voiceChannelId === id;

	const handleClick = () => {
		if (type === "voice") {
			joinVoiceChannel(id);
			return;
		}
		setView({ type, channelId: id });
	};

	return (
		<button
			type="button"
			className={[
				"group flex w-full items-center gap-2 rounded-md px-2 py-1.5",
				"text-sm transition-colors",
				active
					? "bg-selected text-primary"
					: "text-muted hover:bg-hover hover:text-primary",
			].join(" ")}
			onClick={handleClick}
		>
			<span
				aria-hidden
				className={[
					"shrink-0 text-base leading-none text-muted group-hover:text-secondary",
					connected ? "text-online" : "text-muted",
				].join(" ")}
			>
				{type === "text" ? "#" : "🔊"}
			</span>

			<span className="truncate">{name}</span>
		</button>
	);
}

export { Channel };

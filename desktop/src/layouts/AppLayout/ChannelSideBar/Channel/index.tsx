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
		id: "general",
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
						<ChannelItem key={channel.id} type="text" name={channel.name} />
					))}
				</div>
			</section>

			<section className="mt-5">
				<h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted">
					Voice Channels
				</h2>

				<div className="mt-1">
					{voiceChannels.map((channel) => (
						<ChannelItem key={channel.id} type="voice" name={channel.name} />
					))}
				</div>
			</section>
		</div>
	);
};

interface ChannelItemProps {
	name: string;
	type: "text" | "voice";
	active?: boolean;
}

export function ChannelItem({ name, type, active = false }: ChannelItemProps) {
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
		>
			<span
				aria-hidden
				className="shrink-0 text-base leading-none text-muted group-hover:text-secondary"
			>
				{type === "text" ? "#" : "🔊"}
			</span>

			<span className="truncate">{name}</span>
		</button>
	);
}

export { Channel };

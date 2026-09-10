interface MessageDateDividerProps {
	label: string;
}

const ChatDivider = ({ label }: MessageDateDividerProps) => {
	return (
		<div className="flex items-center gap-3 px-4 py-2">
			<div className="h-px flex-1 bg-divider" />

			<span className="shrink-0 text-xs font-semibold text-muted">{label}</span>

			<div className="h-px flex-1 bg-divider" />
		</div>
	);
};

export { ChatDivider };

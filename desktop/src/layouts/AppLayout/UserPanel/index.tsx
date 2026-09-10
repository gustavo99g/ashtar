const UserPanel = () => {
	return (
		<section className="shrink-0 bg-surface-low px-2 py-2">
			<button
				type="button"
				className="
          flex w-full items-center gap-2
          rounded-md
          px-2 py-1.5
          text-left
          transition-colors
          hover:bg-hover
        "
			>
				<div
					className="
            flex size-8 shrink-0 items-center justify-center
            rounded-full
            bg-accent
            text-xs font-semibold
            text-inverse
          "
				>
					G
				</div>

				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium text-primary">
						Gustavo
					</div>

					<div className="truncate text-xs text-muted">Online</div>
				</div>
			</button>
		</section>
	);
};

export { UserPanel };

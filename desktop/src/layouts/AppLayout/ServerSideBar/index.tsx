const ServerSideBar = () => {
	return (
		<nav
			aria-label="Servidores"
			className="
          flex
          w-18
          shrink-0
          flex-col
          items-center
          gap-2
          bg-surface-low
          py-3
        "
		>
			<button
				type="button"
				className="
            flex size-12 items-center justify-center
            rounded-xl
            bg-accent
            text-inverse
            transition-colors
            hover:bg-accent-hover
            active:bg-accent-active
          "
				aria-label="Meu servidor"
			>
				D
			</button>
		</nav>
	);
};

export { ServerSideBar };

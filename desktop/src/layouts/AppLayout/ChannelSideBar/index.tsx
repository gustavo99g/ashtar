import { UserPanel } from "../UserPanel";
import { Channel } from "./Channel";

const ChannelSideBar = () => {
	return (
		<aside
			className="
        flex
        w-60
        shrink-0
        flex-col
        overflow-hidden
        bg-surface-alt
      "
		>
			<header
				className="
          flex h-12 shrink-0 items-center
          border-b border-line
          px-4
        "
			>
				<span className="truncate text-sm font-semibold text-primary">
					Meu Servidor
				</span>
			</header>

			<Channel />

			<UserPanel />
		</aside>
	);
};

export { ChannelSideBar };

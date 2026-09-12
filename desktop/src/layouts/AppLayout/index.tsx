import type { ReactNode } from "react";
import { ChannelSideBar } from "./ChannelSideBar";
import { MainContent } from "./MainContent";
import { ServerSideBar } from "./ServerSideBar";

interface AppLayoutProps {
	children?: ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
	return (
		<div className="flex h-screen w-screen overflow-hidden bg-surface text-primary">
			<ServerSideBar />

			<ChannelSideBar />

			<main className="flex min-w-0 flex-1 flex-col bg-surface">
				{children ?? <MainContent />}
			</main>
		</div>
	);
};

export { AppLayout };

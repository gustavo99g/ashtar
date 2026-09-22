import { Chat } from "@/components/chat";
import { Voice } from "@/components/voice";
import { useNavigationStore } from "@/stores/navigation";

const MainContent = () => {
	const currentView = useNavigationStore((state) => state.currentView);

	if (currentView.type === "text") {
		return <Chat />;
	}

	if (currentView.type === "voice") {
		return <Voice />;
	}

	return <DefaultView />;
};

const DefaultView = () => {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center bg-surface">
			<div className="text-center">
				<h1 className="text-lg font-semibold text-primary">Bem-vindo!</h1>

				<p className="mt-1 text-sm text-muted">
					Selecione um canal para começar.
				</p>
			</div>
		</div>
	);
};

export { MainContent };

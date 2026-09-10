import { Button } from "@/components/ui/button";

const VoiceHeader = () => {
	return (
		<header className="flex h-12 shrink-0 items-center border-b border-line px-4">
			<span className="mr-2 text-lg text-muted">🔊</span>

			<div className="min-w-0">
				<h1 className="truncate text-sm font-semibold text-primary">General</h1>

				<p className="text-xs text-muted">Canal de voz</p>
			</div>

			<div className="ml-auto flex items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Notificações"
				>
					🔔
				</Button>

				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Mais opções"
				>
					⋯
				</Button>
			</div>
		</header>
	);
};

export { VoiceHeader };

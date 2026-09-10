import { Button } from "@/components/ui/button";

const ChatHeader = () => {
	return (
		<header className="flex h-12 shrink-0 items-center border-b border-line px-4">
			<span className="mr-2 text-lg font-medium text-muted">#</span>

			<div className="min-w-0">
				<h1 className="truncate text-sm font-semibold text-primary">general</h1>
			</div>

			<div className="mx-4 h-5 w-px bg-line" />

			<p className="truncate text-xs text-muted">Conversa geral do servidor</p>

			<div className="ml-auto flex items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Notificações"
				>
					🔔
				</Button>

				<Button type="button" variant="ghost" size="icon" aria-label="Membros">
					👥
				</Button>

				<Button type="button" variant="ghost" size="icon" aria-label="Buscar">
					🔎
				</Button>
			</div>
		</header>
	);
};

export { ChatHeader };

import { Button } from "@/components/ui/button";

const VoiceControls = () => {
	return (
		<footer className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-surface-alt px-4 py-3">
			<Button
				type="button"
				variant="secondary"
				size="icon"
				aria-label="Desativar microfone"
			>
				🎙️
			</Button>

			<Button
				type="button"
				variant="secondary"
				size="icon"
				aria-label="Desativar áudio"
			>
				🔊
			</Button>

			<Button
				type="button"
				variant="outline"
				size="icon"
				aria-label="Sair do canal"
			>
				📞
			</Button>
		</footer>
	);
};

export { VoiceControls };

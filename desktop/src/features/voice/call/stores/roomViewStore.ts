/**
 * Como a sala está sendo vista: em Grade ou no palco, assistindo uma ou várias transmissões (ADR
 * 0024). Fica num store para sobreviver à ida às configurações (a rota da sala desmonta embaixo
 * delas) e para quem está fora da sala (a tela do servidor, um aviso) abrir a sala já assistindo.
 *
 * Quem assiste e sai da sala continua assistindo na miniatura (`MiniShare`), uma transmissão por
 * vez, por cima do canal de texto.
 */
import { create } from "zustand";

/** O tamanho em que uma transmissão aparece: grande, ou pequena na fileira de baixo. */
export type ShownSize = "full" | "small";

interface RoomViewState {
	/**
	 * As transmissões abertas, pelo id de quem transmite, na ordem em que a pessoa abriu. Vazio é a
	 * Grade.
	 */
	watching: readonly string[];
	/** A transmissão em foco (grande, com as outras embaixo), ou nenhuma. */
	focused: string | null;
	/**
	 * A câmera em foco (v0.7): a de quem, grande no palco, com o resto embaixo. Vale só enquanto a
	 * câmera está ligada; desligou, a sala volta para o que mostrava antes.
	 */
	focusedCamera: string | null;
	/** Qual transmissão a miniatura mostra quando há várias abertas (as setas trocam). */
	miniPick: string | null;
	/**
	 * As transmissões desenhadas agora, no palco ou na miniatura, e em que tamanho: quem desenha
	 * marca ao aparecer e desmarca ao sair. Só essas telas são baixadas (`subscriptions.ts`). Nas
	 * configurações, nenhuma aparece, e nada é baixado.
	 */
	shown: Readonly<Record<string, ShownSize>>;
	/**
	 * Os blocos de quem está na sala à vista, e em que tamanho: grandes na Grade, pequenos na
	 * fileira de baixo do palco. Só aí as câmeras são baixadas (ADR 0025); `false` na miniatura, num
	 * canal de texto ou nas configurações.
	 */
	camerasShown: ShownSize | false;
}

export const useRoomView = create<RoomViewState>()(() => ({
	watching: [],
	focused: null,
	focusedCamera: null,
	miniPick: null,
	shown: {},
	camerasShown: false,
}));

/** Abre a transmissão de `identity`, junto das que já estão abertas. */
export function watchShare(identity: string): void {
	useRoomView.setState((state) =>
		state.watching.includes(identity)
			? state
			: { watching: [...state.watching, identity] },
	);
}

/** Fecha só a transmissão de `identity`. */
export function unwatchShare(identity: string): void {
	useRoomView.setState((state) => ({
		watching: state.watching.filter((id) => id !== identity),
		focused: state.focused === identity ? null : state.focused,
		miniPick: state.miniPick === identity ? null : state.miniPick,
	}));
}

/**
 * Põe `identity` em foco; de novo na que já está em foco, volta para a divisão. Com uma câmera em
 * foco, a transmissão escolhida toma o lugar dela.
 */
export function focusShare(identity: string | null): void {
	useRoomView.setState((state) => ({
		focused:
			identity === state.focused && !state.focusedCamera ? null : identity,
		focusedCamera: null,
	}));
}

/** Põe a câmera de `identity` em foco; de novo na mesma (ou `null`), tira. */
export function focusCamera(identity: string | null): void {
	useRoomView.setState((state) => ({
		focusedCamera: identity === state.focusedCamera ? null : identity,
	}));
}

/** Escolhe qual transmissão a miniatura mostra. */
export function pickMiniShare(identity: string): void {
	useRoomView.setState({ miniPick: identity });
}

/** Volta para a Grade: fecha todas (e a miniatura). */
export function stopWatching(): void {
	useRoomView.setState({
		watching: [],
		focused: null,
		focusedCamera: null,
		miniPick: null,
	});
}

/** A transmissão de `identity` aparece na tela, nesse tamanho; `null` tira. */
export function setShown(identity: string, size: ShownSize | null): void {
	useRoomView.setState((state) => {
		if ((state.shown[identity] ?? null) === size) return state;
		const shown = { ...state.shown };
		if (size === null) delete shown[identity];
		else shown[identity] = size;
		return { shown };
	});
}

/** Os blocos da sala aparecem (ou saem): as câmeras passam a ser baixadas (ou deixam de ser). */
export function setCamerasShown(shown: ShownSize | false): void {
	useRoomView.setState({ camerasShown: shown });
}

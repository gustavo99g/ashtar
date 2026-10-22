/**
 * O que falta no jsdom. Roda antes do `setup.ts`, porque o React lê isto quando carrega.
 */

// Sem `AnimationEvent`, o React escuta `webkitAnimationEnd` no lugar de `animationend` e o
// `onAnimationEnd` nunca dispara nos testes (a barra de tempo do aviso depende dele).
if (!("AnimationEvent" in window)) {
	class AnimationEvent extends Event {
		readonly animationName: string;
		readonly elapsedTime: number;
		readonly pseudoElement: string;

		constructor(type: string, init: AnimationEventInit = {}) {
			super(type, init);
			this.animationName = init.animationName ?? "";
			this.elapsedTime = init.elapsedTime ?? 0;
			this.pseudoElement = init.pseudoElement ?? "";
		}
	}
	Object.defineProperty(window, "AnimationEvent", {
		value: AnimationEvent,
		writable: true,
	});
}

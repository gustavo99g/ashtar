/**
 * Quando avisar "Você está mutado" (ADR 0029, decisão 18): na primeira vez que a pessoa fala com o
 * microfone mutado, e de novo só depois de ela ficar quieta um pouco. Falando sem parar, o aviso
 * não repete.
 */

/** Quanto o aviso fica no painel de voz. */
export const WARNING_MS = 3000;
/** Quanto silêncio rearma o aviso. */
export const REARM_MS = 2000;

export class MutedWarningState {
	private armed = true;
	private quietMs = 0;

	/** Um bloco de `blockMs`, falando ou não: devolve se o aviso aparece agora. */
	step(speaking: boolean, blockMs: number): boolean {
		if (speaking) {
			this.quietMs = 0;
			if (!this.armed) return false;
			this.armed = false;
			return true;
		}
		this.quietMs += blockMs;
		if (this.quietMs >= REARM_MS) this.armed = true;
		return false;
	}
}

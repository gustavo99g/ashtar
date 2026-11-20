/**
 * Para o Ausente automático (ADR 0027): quanto tempo faz que ninguém mexe no teclado nem no mouse,
 * em todo o Windows. Espelha `commands/presence.rs`.
 */
import { call } from "./core";

/** Os segundos desde o último toque. Rejeita com um `AppError`. */
export function idleSeconds() {
	return call<number>("idle_seconds");
}

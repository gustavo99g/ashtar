/**
 * A sala de voz que sempre existe (a `sala` do banco, que não se arquiva). Desde a v0.5 há várias
 * salas (ADR 0026), e nenhuma tela assume uma: este id só serve de nome quando a lista de canais
 * ainda não chegou.
 */
export const DEFAULT_ROOM_ID = "sala";

/** O nome de uma sala que a lista de canais não tem (ainda não carregou, ou foi arquivada). */
export function fallbackRoomName(id: string): string {
	return id === DEFAULT_ROOM_ID ? "Sala" : "sala de voz";
}

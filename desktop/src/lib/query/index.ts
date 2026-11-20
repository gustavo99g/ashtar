/**
 * Porta de entrada do cache da API (TanStack Query). Fica em `lib/` para o código das features
 * que roda fora de componentes (limpar o cache ao sair do grupo, os eventos do chat) poder usar
 * a mesma instância.
 */
export { useOptionalQueryClient } from "./optional";
export { createQueryClient, queryClient, shouldRetry } from "./queryClient";

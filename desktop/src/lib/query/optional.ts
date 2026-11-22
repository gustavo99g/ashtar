/**
 * O cliente do cache para os hooks que leem um dado "de enfeite" (o nome de uma sala, uma
 * permissão) em componentes que também vivem sem o `QueryClientProvider`, como os testes de uma
 * peça só. Sem provedor, a consulta usa um cliente vazio e desligado: devolve `undefined`, em vez
 * de quebrar.
 */
import { QueryClient, QueryClientContext } from "@tanstack/react-query";
import { useContext } from "react";

const EMPTY = new QueryClient();

/** O cliente do provedor, se há um, e se há. */
export function useOptionalQueryClient(): {
	client: QueryClient;
	present: boolean;
} {
	const client = useContext(QueryClientContext);
	return { client: client ?? EMPTY, present: client !== undefined };
}

import { useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { type Session, useSessionStore } from "@/features/identity";
import { paths } from "@/lib/paths";

/**
 * Guarda das telas de convite: quem já tem conta neste computador, ou ainda está entrando, não
 * tem o que fazer nelas. Só a abertura (`routes/start`) e o `LinkWatcher` mandam para cá; esta
 * guarda cobre quem chega por outro caminho (os atalhos provisórios, um endereço antigo).
 *
 * - `connected`: vai para a tela do servidor;
 * - `entering`: vai para a abertura, que faz o login e decide;
 * - o resto (`noAccount`, `leftGroup`, `error`) fica.
 *
 * A conferência é só **na chegada**. Depois de um `redeem` que deu certo a sessão vira
 * `connected` com a pessoa ainda aqui, e ela precisa ver as boas-vindas antes de seguir.
 * Navegar entre as telas desta guarda (do campo de colar para a escolha do nick, por exemplo)
 * não repete a conferência, porque o layout continua montado.
 *
 * A tela "Você já está no Ashtar" fica fora: ela é justamente para quem já tem conta.
 */
export function RequireNoAccount() {
	const [arrivedAs] = useState<Session["status"]>(
		() => useSessionStore.getState().session.status,
	);

	if (arrivedAs === "connected") return <Navigate to={paths.server} replace />;
	if (arrivedAs === "entering") return <Navigate to={paths.start} replace />;
	return <Outlet />;
}

/** Sobre o próprio app: as novidades e a pasta de logs. Espelha `commands/app.rs`. */
import { call } from "./core";

export interface WhatsNew {
	version: string;
	notes: string;
}

/** A seção do CHANGELOG.md da versão em execução, ou `null`. */
export function whatsNew() {
	return call<WhatsNew | null>("whats_new");
}

/** Abre a pasta de logs do app no Explorador de Arquivos. Rejeita com um `AppError`. */
export function openLogDir() {
	return call<void>("open_log_dir");
}

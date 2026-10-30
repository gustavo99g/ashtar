/**
 * O estado da atualização no app: a versão que o Rust já baixou, o aviso no canto e o "O que há
 * de novo" aberto.
 *
 * Quem escreve são os eventos do Rust (`UpdateNotice`) e os botões. O aviso e a tela Aplicativo
 * leem daqui, então os dois mostram a mesma versão pronta, e o Reiniciar de um ou de outro pede a
 * mesma confirmação durante uma chamada, no próprio aviso.
 */
import { create } from "zustand";
import { installUpdate, type WhatsNew, whatsNew } from "@/lib/tauri/commands";

/** O aviso no canto, nos estados do quadro "Atualização: avisos". */
export type UpdateNoticeState =
	| { kind: "ready" }
	| { kind: "confirm" }
	| { kind: "restarting" }
	| { kind: "failed"; message: string };

interface UpdaterState {
	/** A versão baixada que espera o Reiniciar (quem guarda é o Rust; aqui é o espelho). */
	readyVersion: string | null;
	/** O aviso no canto. `null` quando não há nada, ou depois do "Depois". */
	notice: UpdateNoticeState | null;
	/**
	 * A seção do CHANGELOG.md do "O que há de novo". Continua aqui depois de fechar, para o
	 * diálogo ter o que mostrar na animação de saída.
	 */
	whatsNew: WhatsNew | null;
	whatsNewOpen: boolean;
}

export const useUpdaterStore = create<UpdaterState>()(() => ({
	readyVersion: null,
	notice: null,
	whatsNew: null,
	whatsNewOpen: false,
}));

/**
 * A última versão cujo "O que há de novo" a pessoa já viu. O `localStorage` é da pasta de dados do
 * app (o identificador): o app instalado e o de desenvolvimento não se misturam.
 */
const LAST_SEEN_KEY = "ashtar.lastSeenVersion";

/** Quando o Reiniciar falha, a versão continua baixada: o Rust tenta de novo ao fechar o app. */
const INSTALL_FAILED = "Tentamos de novo mais tarde.";

/** O Rust terminou de baixar uma versão (o evento `update-ready`, ou o `pendingUpdate` ao abrir). */
export function updateReady(version: string) {
	useUpdaterStore.setState((state) => ({
		readyVersion: version,
		// O "Reiniciando…" fica até o app fechar.
		notice:
			state.notice?.kind === "restarting" ? state.notice : { kind: "ready" },
	}));
}

/** A verificação falhou por assinatura, manifesto ou download (o evento `update-failed`). */
export function updateFailed(message: string) {
	useUpdaterStore.setState({ notice: { kind: "failed", message } });
}

/**
 * O Reiniciar do aviso e da tela Aplicativo. Numa chamada, primeiro pergunta no próprio aviso
 * ("Reiniciar agora?"); fora dela, instala na hora.
 */
export function restartToUpdate(inCall: boolean) {
	if (inCall) {
		useUpdaterStore.setState({ notice: { kind: "confirm" } });
		return;
	}
	void install();
}

/** O Reiniciar da confirmação. */
export function confirmRestart() {
	void install();
}

/**
 * O "Depois" da confirmação e o X do "Não deu para atualizar": o aviso some. A versão pronta, se
 * houver, continua baixada e é instalada ao fechar o app, e a tela Aplicativo ainda mostra o
 * Reiniciar.
 */
export function hideUpdateNotice() {
	useUpdaterStore.setState({ notice: null });
}

async function install() {
	useUpdaterStore.setState({ notice: { kind: "restarting" } });
	try {
		// Se der certo, não volta: o app fecha e o instalador abre.
		await installUpdate();
	} catch {
		useUpdaterStore.setState({
			notice: { kind: "failed", message: INSTALL_FAILED },
		});
	}
}

/**
 * Na abertura: mostra o "O que há de novo" desta versão uma vez, na primeira abertura depois de
 * atualizar. Sem seção no CHANGELOG.md, não mostra nada.
 */
export async function showWhatsNewOnce() {
	const content = await whatsNew().catch(() => null);
	if (!content || localStorage.getItem(LAST_SEEN_KEY) === content.version)
		return;
	useUpdaterStore.setState({ whatsNew: content, whatsNewOpen: true });
}

/** O link "Ver o que há de novo nesta versão" da tela Aplicativo: abre mesmo que já tenha sido visto. */
export async function openWhatsNew() {
	const content = await whatsNew().catch(() => null);
	if (content)
		useUpdaterStore.setState({ whatsNew: content, whatsNewOpen: true });
}

/** Entendi, Esc ou clicar fora: fecha e guarda a versão como vista. */
export function closeWhatsNew() {
	const content = useUpdaterStore.getState().whatsNew;
	if (content) localStorage.setItem(LAST_SEEN_KEY, content.version);
	useUpdaterStore.setState({ whatsNewOpen: false });
}

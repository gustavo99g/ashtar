/**
 * Qual diálogo de canais está aberto. Quem abre são os menus da coluna e o cabeçalho do canal; quem
 * desenha é o `ChannelDialogs`, montado uma vez no `AppShell`. Assim o diálogo não some quando o
 * menu que o abriu fecha.
 */
import { create } from "zustand";
import type { CategoryView, ChannelView } from "@/lib/api";

export type ChannelDialog =
	| { kind: "createChannel"; categoryId: string | null }
	| { kind: "editChannel"; channel: ChannelView; focus?: "topic" }
	| { kind: "archiveChannel"; channel: ChannelView }
	| { kind: "createCategory" }
	| { kind: "renameCategory"; category: CategoryView }
	| { kind: "archiveCategory"; category: CategoryView };

interface DialogState {
	dialog: ChannelDialog | null;
}

export const useChannelDialog = create<DialogState>()(() => ({ dialog: null }));

export function openChannelDialog(dialog: ChannelDialog): void {
	useChannelDialog.setState({ dialog });
}

export function closeChannelDialog(): void {
	useChannelDialog.setState({ dialog: null });
}

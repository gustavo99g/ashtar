import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSession } from "@/features/identity";
import {
	createEmoji,
	deleteEmoji,
	listEmojis,
	renameEmoji,
	uploadFile,
} from "@/lib/api";
import { prepareEmojiImage } from "./model/emojiImage";
import { clearEmojis, setEmojis } from "./stores/emojiStore";

export const emojisKeys = {
	all: () => ["emojis"] as const,
};

/**
 * Carrega a lista ao entrar (o `AppShell` monta) e põe no store. Depois quem mantém em dia é o
 * `emojis.changed`.
 */
export function useLoadEmojis(): void {
	const connected = useSession().status === "connected";
	const query = useQuery({
		queryKey: emojisKeys.all(),
		queryFn: listEmojis,
		enabled: connected,
		staleTime: Number.POSITIVE_INFINITY,
	});
	useEffect(() => {
		if (query.data) setEmojis(query.data);
	}, [query.data]);
	useEffect(() => {
		if (!connected) clearEmojis();
	}, [connected]);
}

/** Reduz a imagem (o GIF vai como está), envia e cria o emoji. */
export function useCreateEmoji() {
	return useMutation({
		mutationFn: async ({ file, name }: { file: File; name: string }) => {
			const image = await prepareEmojiImage(file);
			const uploaded = await uploadFile(image.blob, {
				kind: "emoji",
				name: image.name,
				width: image.width,
				height: image.height,
			});
			return createEmoji({ name, file_id: uploaded.id });
		},
	});
}

export function useRenameEmoji() {
	return useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) =>
			renameEmoji(id, name),
	});
}

export function useDeleteEmoji() {
	return useMutation({ mutationFn: (id: string) => deleteEmoji(id) });
}

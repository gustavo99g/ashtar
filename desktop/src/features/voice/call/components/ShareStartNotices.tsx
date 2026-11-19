import { ScreenShareIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { useMyStatus } from "@/features/identity";
import { useScreenShares } from "@/features/screen-share";
import { useSettingsStore } from "@/features/settings";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import { joinNames, startedShares } from "../model/shareStarts";
import { useRoomView, watchShare } from "../stores/roomViewStore";
import { NoticeIcon } from "./NoticeIcon";

/**
 * O aviso de transmissão nova dentro da sala (ADR 0024): "fulano começou a transmitir", com
 * Assistir, que abre a transmissão junto das que já estão abertas. Fora da sala, quem avisa é a
 * `features/notifications`.
 *
 * Não avisa a própria transmissão, a que a pessoa já assiste, as que estavam no ar ao entrar nem
 * quem parou e voltou em poucos segundos (`shareStarts.ts`). Em Ocupado, ou com a chave "Alguém
 * começou a transmitir" desligada em Configurações › Notificações, nada. Várias começando juntas
 * viram um aviso só. Sem som. Fica montado durante a chamada (`VoiceDock`).
 */
export function ShareStartNotices() {
	const shares = useScreenShares();
	const members = useLiveMembers();
	const status = useMyStatus();
	const streams = useSettingsStore((state) => state.notifications.streams);

	const previous = useRef<ReadonlySet<string> | null>(null);
	const endedAt = useRef(new Map<string, number>());

	const current = shares
		.filter((share) => !share.isOwn)
		.map((share) => share.ownerId);
	const key = current.join("\n");

	useEffect(() => {
		const now = Date.now();
		const ids = key ? key.split("\n") : [];
		const before = previous.current;
		const started = startedShares(before, ids, endedAt.current, now);
		if (before) {
			for (const id of before) {
				if (!ids.includes(id)) endedAt.current.set(id, now);
			}
		}
		previous.current = new Set(ids);

		const { watching } = useRoomView.getState();
		const fresh = started.filter((id) => !watching.includes(id));
		if (fresh.length === 0 || status === "busy" || !streams) return;
		const people = fresh
			.map((id) => members.find((member) => member.id === id))
			.filter((member) => member !== undefined);
		if (people.length === 0) return;

		const names = joinNames(people.map((person) => person.name));
		const id = toast.add({
			title:
				people.length === 1
					? `${names} começou a transmitir`
					: `${names} começaram a transmitir`,
			description:
				people.length === 1
					? "Abra para assistir junto do que você já está vendo."
					: "Assistir abre todas, junto do que você já está vendo.",
			data: {
				media: (
					<NoticeIcon tone="gold">
						<ScreenShareIcon />
					</NoticeIcon>
				),
			},
			actionProps: {
				children: "Assistir",
				onClick: () => {
					toast.close(id);
					for (const person of people) watchShare(person.id);
				},
			},
		});
		// `members` muda a cada fala; o aviso só olha a lista de transmissões.
	}, [key]);

	return null;
}
